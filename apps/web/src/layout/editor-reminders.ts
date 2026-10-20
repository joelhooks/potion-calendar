import { Reminder } from "@calendar/calendar/contracts";
import type { ReminderValue } from "@calendar/calendar/contracts";
import { Effect, Schema } from "effect";

import { EditorInputFailure } from "../client/editing/input-failure.js";

const DurationText = Schema.String.check(
  Schema.isPattern(/^(?:\d+(?:\.\d+)?[wdhm])+$/u)
);

const Unit = Schema.Literals(["w", "d", "h", "m"]);

const factors: Readonly<Record<typeof Unit.Type, number>> = {
  d: 1440,
  h: 60,
  m: 1,
  w: 10_080,
};

const invalidReminderText = () =>
  new EditorInputFailure({
    message:
      "Enter 1 minute to 28 days, using whole minutes. Choose At start for zero.",
  });

const compactDuration = (input: string): string =>
  input
    .toLowerCase()
    .replaceAll(/weeks?/gu, "w")
    .replaceAll(/days?/gu, "d")
    .replaceAll(/hours?/gu, "h")
    .replaceAll(/minutes?|mins?/gu, "m")
    .replaceAll(/\s/gu, "");

export const parseReminderInput = Effect.fn("parseReminderInput")(
  function* parseReminderInput(input: string) {
    const text = yield* Schema.decodeEffect(DurationText)(
      compactDuration(input)
    ).pipe(Effect.mapError(invalidReminderText));

    let minutes = 0;

    for (const token of text.matchAll(
      /(?<amount>\d+(?:\.\d+)?)(?<unit>[wdhm])/gu
    )) {
      const amount = yield* Schema.decodeUnknownEffect(Schema.FiniteFromString)(
        token.groups?.amount
      ).pipe(Effect.mapError(invalidReminderText));

      const unit = yield* Schema.decodeUnknownEffect(Unit)(
        token.groups?.unit
      ).pipe(Effect.mapError(invalidReminderText));

      minutes += amount * factors[unit];
    }

    if (minutes <= 0) {
      return yield* invalidReminderText();
    }

    const reminder = yield* Schema.decodeEffect(Reminder)({
      method: "popup",
      minutes,
    }).pipe(Effect.mapError(invalidReminderText));

    return reminder.minutes;
  }
);

export const addReminder = Effect.fn("addReminder")(function* addReminder(
  current: readonly ReminderValue[],
  minutes: number,
  limit: number
) {
  if (current.some((reminder) => reminder.minutes === minutes)) {
    return yield* new EditorInputFailure({
      message: "That reminder is already selected.",
    });
  }

  if (current.length >= limit) {
    return yield* new EditorInputFailure({
      message: `Reminders limited to ${limit}`,
    });
  }

  const reminder = yield* Schema.decodeEffect(Reminder)({
    method: "popup",
    minutes,
  }).pipe(
    Effect.mapError(
      () =>
        new EditorInputFailure({
          message: "Choose a reminder inside Google's supported range.",
        })
    )
  );

  return [...current, reminder];
});
