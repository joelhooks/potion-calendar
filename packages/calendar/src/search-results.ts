import { DateTime, Option } from "effect";

import type {
  CalendarEventValue,
  CalendarValue,
  EventTimeValue,
} from "./model.js";
import type { SearchEventResultValue } from "./search-model.js";

export const matchesLocalSearch = (
  event: CalendarEventValue,
  query: string
): boolean => {
  const trimmed = query.trim().toLowerCase();

  if (trimmed === "") {
    return false;
  }

  const fields = [
    event.title,
    event.description,
    event.location,
    event.organizer?.displayName,
    event.organizer?.email,
    ...(event.attendees ?? []).flatMap((attendee) => [
      attendee.displayName,
      attendee.email,
    ]),
  ].map((field) => (field ?? "").toLowerCase());

  return trimmed
    .split(/\s+/u)
    .some((token) => fields.some((field) => field.includes(token)));
};

const searchInstant = (time: EventTimeValue | undefined, timeZone: string) => {
  if (time === undefined) {
    return Option.none<DateTime.Zoned>();
  }

  return "date" in time
    ? DateTime.makeZoned(time.date, {
        adjustForTimeZone: true,
        disambiguation: "reject",
        timeZone,
      })
    : DateTime.makeZoned(time.dateTime, { timeZone });
};

export const searchEventResult = (
  calendar: CalendarValue,
  event: CalendarEventValue,
  timeZone: string
): Option.Option<SearchEventResultValue> => {
  if (
    event.status === "cancelled" ||
    calendar.accessRole === "freeBusyReader" ||
    calendar.accountId === "" ||
    calendar.calendarId === "" ||
    event.accountId !== calendar.accountId ||
    event.calendarId !== calendar.calendarId ||
    event.eventId === ""
  ) {
    return Option.none();
  }

  const start = searchInstant(event.start, timeZone);
  const end = searchInstant(event.end, timeZone);

  if (Option.isNone(start) || Option.isNone(end)) {
    return Option.none();
  }

  const startMillis = DateTime.toEpochMillis(start.value);
  const endMillis = DateTime.toEpochMillis(end.value);

  if (endMillis <= startMillis) {
    return Option.none();
  }

  return Option.some({ calendar, endMillis, event, startMillis });
};

export const orderSearchResults = (
  results: readonly SearchEventResultValue[]
): readonly SearchEventResultValue[] => {
  const seen = new Set<string>();

  return results
    .filter((result) => {
      if (seen.has(result.event.eventId)) {
        return false;
      }

      seen.add(result.event.eventId);

      return true;
    })
    .toSorted((left, right) => left.startMillis - right.startMillis);
};
