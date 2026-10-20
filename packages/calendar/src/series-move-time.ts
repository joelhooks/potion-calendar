import { DateTime, Effect, Option, Schema } from "effect";

import type {
  CalendarEventValue,
  EventRefValue,
  EventTimeValue,
} from "./model.js";
import { SeriesMoveRetimeRefused } from "./series-move-result.js";

const offsetTimestamp = Schema.String.check(
  Schema.isPattern(/(?:Z|[+-]\d{2}:\d{2})$/iu)
);

const calendarDay = (value: DateTime.DateTime) => {
  const { year, month, day } = DateTime.toParts(value);

  return DateTime.toEpochMillis(DateTime.makeUnsafe({ day, month, year }));
};

const clockParts = (value: DateTime.DateTime) => {
  const { hour, minute, second, millisecond } = DateTime.toParts(value);

  return { hour, millisecond, minute, second };
};

const zonedTime = Effect.fn("seriesMoveZonedTime")(function* zonedTime(
  ref: EventRefValue,
  time: EventTimeValue | undefined,
  zone: string
) {
  if (time === undefined || "date" in time) {
    return yield* new SeriesMoveRetimeRefused({
      ...ref,
      reason: "timedEventRequired",
    });
  }

  if (Option.isNone(Schema.decodeOption(offsetTimestamp)(time.dateTime))) {
    return yield* new SeriesMoveRetimeRefused({
      ...ref,
      reason: "invalidTime",
    });
  }

  const value = DateTime.makeZoned(time.dateTime, { timeZone: zone });

  if (Option.isNone(value)) {
    return yield* new SeriesMoveRetimeRefused({
      ...ref,
      reason: "invalidTime",
    });
  }

  return value.value;
});

export const seriesMoveTimes = Effect.fn("seriesMoveTimes")(
  function* seriesMoveTimes(
    selected: CalendarEventValue,
    master: CalendarEventValue,
    start: EventTimeValue,
    end: EventTimeValue
  ) {
    const ref = {
      accountId: selected.accountId,
      calendarId: selected.calendarId,
      eventId: selected.eventId,
    };

    if (master.start === undefined || "date" in master.start) {
      return yield* new SeriesMoveRetimeRefused({
        ...ref,
        reason: "timedEventRequired",
      });
    }

    const zone = master.start.timeZone;

    if (zone === undefined) {
      return yield* new SeriesMoveRetimeRefused({
        ...ref,
        reason: "masterTimeZoneRequired",
      });
    }

    const original = yield* zonedTime(ref, selected.start, zone);
    const desiredStart = yield* zonedTime(ref, start, zone);
    const desiredEnd = yield* zonedTime(ref, end, zone);
    const masterStart = yield* zonedTime(ref, master.start, zone);

    if (
      DateTime.formatIsoDate(original) !== DateTime.formatIsoDate(desiredStart)
    ) {
      return yield* new SeriesMoveRetimeRefused({
        ...ref,
        reason: "dateChanged",
      });
    }

    const duration =
      DateTime.toEpochMillis(desiredEnd) - DateTime.toEpochMillis(desiredStart);

    if (duration <= 0) {
      return yield* new SeriesMoveRetimeRefused({
        ...ref,
        reason: "invalidDuration",
      });
    }

    const placed = DateTime.makeZoned(
      { ...DateTime.toParts(masterStart), ...clockParts(desiredStart) },
      { adjustForTimeZone: true, disambiguation: "reject", timeZone: zone }
    );

    if (Option.isNone(placed)) {
      return yield* new SeriesMoveRetimeRefused({
        ...ref,
        reason: "unrepresentableTime",
      });
    }

    const placedEnd = DateTime.addDuration(placed.value, duration);
    const endClock = clockParts(placedEnd);
    const wantedClock = clockParts(desiredEnd);

    if (
      endClock.hour !== wantedClock.hour ||
      endClock.minute !== wantedClock.minute ||
      endClock.second !== wantedClock.second ||
      endClock.millisecond !== wantedClock.millisecond ||
      calendarDay(placedEnd) - calendarDay(placed.value) !==
        calendarDay(desiredEnd) - calendarDay(desiredStart)
    ) {
      return yield* new SeriesMoveRetimeRefused({
        ...ref,
        reason: "durationTransition",
      });
    }

    return {
      end: { dateTime: DateTime.formatIso(placedEnd), timeZone: zone },
      start: { dateTime: DateTime.formatIso(placed.value), timeZone: zone },
    };
  }
);
