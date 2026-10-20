import { DateTime, Effect, Schema } from "effect";

import { Provider } from "./errors.js";
import type { EventTimeValue } from "./model.js";

const invalid = () =>
  new Provider({
    message:
      "The series time-zone change cannot preserve its calendar date and clock. Change this occurrence or choose another time.",
    operation: "recurrence",
    status: 0,
  });

const calendarDate = (value: DateTime.Zoned) => {
  const { year, month, day } = DateTime.toParts(value);

  return DateTime.makeUnsafe({ day, month, year });
};

export const seriesZoneTime = Effect.fn("seriesZoneTime")(
  function* seriesZoneTime(
    master: EventTimeValue,
    selected: EventTimeValue,
    changed: EventTimeValue
  ) {
    if ("date" in master || "date" in selected || "date" in changed) {
      return yield* invalid();
    }

    const originalZone = yield* Schema.decodeUnknownEffect(
      Schema.TimeZoneNamedFromString
    )(master.timeZone).pipe(Effect.mapError(invalid));

    const occurrenceZone = yield* Schema.decodeUnknownEffect(
      Schema.TimeZoneNamedFromString
    )(selected.timeZone ?? master.timeZone).pipe(Effect.mapError(invalid));

    const targetZone = yield* Schema.decodeUnknownEffect(
      Schema.TimeZoneNamedFromString
    )(changed.timeZone).pipe(Effect.mapError(invalid));

    const original = yield* Effect.fromOption(
      DateTime.makeZoned(master.dateTime, { timeZone: originalZone })
    ).pipe(Effect.mapError(invalid));

    const occurrence = yield* Effect.fromOption(
      DateTime.makeZoned(selected.dateTime, { timeZone: occurrenceZone })
    ).pipe(Effect.mapError(invalid));

    const desired = yield* Effect.fromOption(
      DateTime.makeZoned(changed.dateTime, { timeZone: targetZone })
    ).pipe(Effect.mapError(invalid));

    const shiftedDate = DateTime.add(calendarDate(original), {
      milliseconds:
        DateTime.toEpochMillis(calendarDate(desired)) -
        DateTime.toEpochMillis(calendarDate(occurrence)),
    });

    const { hour, minute, second, millisecond } = DateTime.toParts(desired);

    const placed = yield* Effect.fromOption(
      DateTime.makeZoned(
        {
          ...DateTime.toPartsUtc(shiftedDate),
          hour,
          millisecond,
          minute,
          second,
        },
        {
          adjustForTimeZone: true,
          disambiguation: "reject",
          timeZone: targetZone,
        }
      )
    ).pipe(Effect.mapError(invalid));

    return {
      dateTime: DateTime.formatIso(placed),
      timeZone: DateTime.zoneToString(targetZone),
    };
  }
);
