import type { EventTimeValue } from "@calendar/calendar/contracts";
import { DateTime, Effect, Option, Schema } from "effect";

import { EditorInputFailure } from "../client/editing/input-failure.js";

const DateText = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u));

const ClockText = Schema.String.check(
  Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/u)
);

export const editorDate = (text: string): Option.Option<DateTime.Utc> =>
  Schema.decodeOption(DateText)(text).pipe(
    Option.flatMap(DateTime.make),
    Option.filter((date) => DateTime.formatIsoDateUtc(date) === text)
  );

export const editorLocalTime = (
  date: string,
  clock: string,
  zone: string
): Option.Option<DateTime.Zoned> => {
  if (
    Option.isNone(editorDate(date)) ||
    Option.isNone(Schema.decodeOption(ClockText)(clock))
  ) {
    return Option.none();
  }

  return DateTime.makeZoned(`${date}T${clock}:00.000Z`, {
    adjustForTimeZone: true,
    timeZone: zone,
  }).pipe(
    Option.filter((value) => {
      const parts = DateTime.toParts(value);

      return (
        DateTime.formatIsoDate(value) === date &&
        `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}` ===
          clock
      );
    })
  );
};

export const eventTimeParts = (
  time: EventTimeValue,
  zone: string
): Option.Option<{ readonly clock: string; readonly date: string }> => {
  if ("date" in time) {
    return editorDate(time.date).pipe(
      Option.map(() => ({ clock: "00:00", date: time.date }))
    );
  }

  return DateTime.makeZoned(time.dateTime, { timeZone: zone }).pipe(
    Option.map((value) => {
      const parts = DateTime.toParts(value);

      return {
        clock: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
        date: DateTime.formatIsoDate(value),
      };
    })
  );
};

export const requireEditorDate = (
  text: string
): Effect.Effect<DateTime.Utc, EditorInputFailure> =>
  Effect.fromOption(editorDate(text)).pipe(
    Effect.mapError(
      () => new EditorInputFailure({ message: "Choose a valid calendar date." })
    )
  );

export const requireEditorTime = (
  date: string,
  clock: string,
  zone: string
): Effect.Effect<DateTime.Zoned, EditorInputFailure> =>
  Effect.fromOption(editorLocalTime(date, clock, zone)).pipe(
    Effect.mapError(
      () =>
        new EditorInputFailure({
          message:
            "Choose a valid time in the event's time zone. A daylight-saving gap is not a valid time.",
        })
    )
  );
