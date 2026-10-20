import type { EventTimeValue } from "@calendar/calendar/contracts";
import { DateTime, Effect, Schema } from "effect";

import type { EventDraftValue } from "../client/editing/editor-model.js";
import type { GestureRange } from "../client/editing/gesture-model.js";
import { EditorInputFailure } from "../client/editing/input-failure.js";
import { eventTimeParts, requireEditorTime } from "./editor-time.js";

export const storedEventZone = (
  start: EventTimeValue,
  masterStart: EventTimeValue | undefined,
  primaryZone: string
): string => {
  if ("date" in start) {
    return primaryZone;
  }

  const masterZone =
    masterStart !== undefined && "dateTime" in masterStart
      ? masterStart.timeZone
      : undefined;

  return start.timeZone ?? masterZone ?? primaryZone;
};

const NamedZoneText = Schema.String.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9_+./-]*$/u)
);

export const requireEditorZone = (value: string) =>
  Schema.decodeEffect(NamedZoneText)(value).pipe(
    Effect.flatMap(Schema.decodeEffect(Schema.TimeZoneNamedFromString)),
    Effect.map(DateTime.zoneToString),
    Effect.mapError(
      () =>
        new EditorInputFailure({
          message: "Choose a valid named time zone for this event.",
        })
    )
  );

const invalidRange = () =>
  new EditorInputFailure({
    message: "The dragged range cannot be shown in the event's time zone.",
  });

export const rebaseEditorRange = Effect.fn("rebaseEditorRange")(
  function* rebaseEditorRange(
    range: typeof GestureRange.Type,
    inputZone: string,
    eventZone: string
  ) {
    if (range.allDay || inputZone === eventZone) {
      return range;
    }

    const from = yield* requireEditorTime(
      range.startDate,
      range.startTime,
      inputZone
    );

    const to = yield* requireEditorTime(
      range.endDate,
      range.endTime,
      inputZone
    );

    const start = yield* Effect.fromOption(
      eventTimeParts({ dateTime: DateTime.formatIso(from) }, eventZone)
    ).pipe(Effect.mapError(invalidRange));

    const end = yield* Effect.fromOption(
      eventTimeParts({ dateTime: DateTime.formatIso(to) }, eventZone)
    ).pipe(Effect.mapError(invalidRange));

    return {
      ...range,
      endDate: end.date,
      endTime: end.clock,
      startDate: start.date,
      startTime: start.clock,
    };
  }
);

export const changeEventZone = Effect.fn("changeEventZone")(
  function* changeEventZone(draft: EventDraftValue, value: string) {
    if (draft.allDay) {
      return yield* new EditorInputFailure({
        message: "All-day events use calendar dates, not a time zone.",
      });
    }

    const timeZone = yield* requireEditorZone(value);

    return { ...draft, timeZone };
  }
);
