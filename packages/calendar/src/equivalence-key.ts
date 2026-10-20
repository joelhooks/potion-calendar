import { DateTime, Option } from "effect";

import type { CalendarEventValue } from "./model.js";

export const equivalenceKey = (
  event: CalendarEventValue
): string | undefined => {
  const uid = event.iCalUID;

  if (uid === undefined || uid.length === 0) {
    return undefined;
  }

  const original = event.originalStartTime;

  if (original === undefined) {
    return event.recurringEventId === undefined
      ? JSON.stringify([uid])
      : undefined;
  }

  if ("date" in original) {
    return JSON.stringify([uid, "date", original.date]);
  }

  return DateTime.make(original.dateTime).pipe(
    Option.map((instant) =>
      JSON.stringify([uid, "instant", DateTime.toEpochMillis(instant)])
    ),
    Option.getOrUndefined
  );
};
