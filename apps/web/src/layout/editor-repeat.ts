import { DateTime, Effect, Schema } from "effect";

import type { RepeatForm, Weekday } from "../client/editing/editor-model.js";
import { EditorInputFailure } from "../client/editing/input-failure.js";
import { requireEditorDate, requireEditorTime } from "./editor-time.js";

const PositiveInteger = Schema.FiniteFromString.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
);

const weekdays: readonly (typeof Weekday.Type)[] = [
  "SU",
  "MO",
  "TU",
  "WE",
  "TH",
  "FR",
  "SA",
];

export interface RepeatInput {
  readonly allDay: boolean;
  readonly repeat: typeof RepeatForm.Type;
  readonly startDate: string;
  readonly timeZone: string;
}

const positiveInteger = (input: string) =>
  Schema.decodeEffect(PositiveInteger)(input).pipe(
    Effect.mapError(
      () =>
        new EditorInputFailure({
          message:
            "Use a positive whole number for the repeat interval or occurrence count.",
        })
    )
  );

const ending = Effect.fn("repeatEnding")(function* repeatEnding(
  input: RepeatInput
) {
  if (input.repeat.end === "never") {
    return "";
  }

  if (input.repeat.end === "after") {
    const count = yield* positiveInteger(input.repeat.count);

    return `;COUNT=${count}`;
  }

  const date = yield* requireEditorDate(input.repeat.until);
  const start = yield* requireEditorDate(input.startDate);

  if (DateTime.toEpochMillis(date) < DateTime.toEpochMillis(start)) {
    return yield* new EditorInputFailure({
      message: "The last repeat date cannot precede the event's start date.",
    });
  }

  if (input.allDay) {
    return `;UNTIL=${input.repeat.until.replaceAll("-", "")}`;
  }

  const lastMinute = yield* requireEditorTime(
    input.repeat.until,
    "23:59",
    input.timeZone
  );

  const lastSecond = DateTime.add(lastMinute, { seconds: 59 });

  return `;UNTIL=${DateTime.formatIso(lastSecond).replaceAll(/[-:]/gu, "").replace(".000", "")}`;
});

export const repeatRules = Effect.fn("repeatRules")(function* repeatRules(
  input: RepeatInput
) {
  const { repeat } = input;

  if (repeat.preset === "unchanged") {
    return repeat.rules;
  }

  if (repeat.preset === "none") {
    return [];
  }

  const date = yield* requireEditorDate(input.startDate);
  const parts = DateTime.toPartsUtc(date);
  const weekday = weekdays[parts.weekDay] ?? "SU";

  if (repeat.preset !== "custom") {
    const common = {
      daily: "FREQ=DAILY",
      monthly: `FREQ=MONTHLY;BYMONTHDAY=${parts.day}`,
      weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      weekly: `FREQ=WEEKLY;BYDAY=${weekday}`,
      yearly: `FREQ=YEARLY;BYMONTH=${parts.month};BYMONTHDAY=${parts.day}`,
    };

    return [`RRULE:${common[repeat.preset]}`];
  }

  const interval = yield* positiveInteger(repeat.interval);
  let rule = `FREQ=${repeat.frequency};INTERVAL=${interval}`;

  if (repeat.frequency === "WEEKLY") {
    const selected = weekdays.filter((day) => repeat.weekdays.includes(day));

    if (selected.length === 0) {
      return yield* new EditorInputFailure({
        message: "Select at least one weekday.",
      });
    }

    rule += `;BYDAY=${selected.join(",")}`;
  }

  if (repeat.frequency === "YEARLY") {
    rule += `;BYMONTH=${parts.month}`;
  }

  if (repeat.frequency === "MONTHLY" || repeat.frequency === "YEARLY") {
    rule +=
      repeat.monthPattern === "weekday"
        ? `;BYDAY=${repeat.ordinal}${repeat.weekday}`
        : `;BYMONTHDAY=${parts.day}`;
  }

  return [`RRULE:${rule}${yield* ending(input)}`];
});
