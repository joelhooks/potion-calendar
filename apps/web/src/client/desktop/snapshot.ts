import type {
  CalendarEventValue,
  EventTimeValue,
} from "@calendar/calendar/contracts";
import type {
  AgendaEventValue,
  AgendaSnapshotValue,
  DesktopPreferencesValue,
} from "@calendar/core/desktop-bridge";
import { DateTime, Option } from "effect";
import { AsyncData } from "foldkit";

import type { AppModel } from "../app.js";
import { calendarKey } from "../calendar-state.js";
import { upcomingSelection } from "../upcoming/update.js";

const minuteMilliseconds = 60_000;

const dayMilliseconds = 24 * 60 * minuteMilliseconds;

export const agendaHorizonMilliseconds = (
  preferences: DesktopPreferencesValue
): number =>
  Math.min(
    30 * dayMilliseconds,
    Math.max(
      preferences.includeDays * dayMilliseconds,
      preferences.previewMinutes * minuteMilliseconds
    )
  );

const eventInstant = (
  time: EventTimeValue,
  zone: string
): Option.Option<number> =>
  ("date" in time
    ? DateTime.makeZoned(`${time.date}T00:00:00.000Z`, {
        adjustForTimeZone: true,
        timeZone: zone,
      }).pipe(
        Option.filter((value) => DateTime.formatIsoDate(value) === time.date)
      )
    : DateTime.make(time.dateTime)
  ).pipe(Option.map(DateTime.toEpochMillis));

const eventTimes = (
  event: CalendarEventValue,
  zone: string
): Option.Option<{
  readonly allDay: boolean;
  readonly start: number;
  readonly end: number;
}> => {
  if (event.start === undefined || event.end === undefined) {
    return Option.none();
  }

  const start = eventInstant(event.start, zone);
  const end = eventInstant(event.end, zone);

  return Option.isSome(start) && Option.isSome(end) && end.value > start.value
    ? Option.some({
        allDay: "date" in event.start,
        end: end.value,
        start: start.value,
      })
    : Option.none();
};

const conferenceUrl = (event: CalendarEventValue): string | null => {
  const url = URL.parse(event.conferenceUrl ?? "");

  return url !== null &&
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === ""
    ? url.href
    : null;
};

const eventResponse = (
  event: CalendarEventValue
): AgendaEventValue["responseStatus"] =>
  event.attendees?.find((attendee) => attendee.self === true)?.responseStatus ??
  (event.status === "tentative" ? "tentative" : "accepted");

const projectSavedEvent = (
  event: CalendarEventValue,
  zone: string,
  calendarColor: string
): Option.Option<AgendaEventValue> => {
  const responseStatus = eventResponse(event);
  const times = eventTimes(event, zone);

  if (
    event.status === "cancelled" ||
    responseStatus === "declined" ||
    Option.isNone(times)
  ) {
    return Option.none();
  }

  const title = event.title?.trim() ?? "";

  return Option.some({
    ...times.value,
    calendarColor,
    conferenceUrl: conferenceUrl(event),
    hasLocation: (event.location?.trim().length ?? 0) > 0,
    hasParticipants: (event.attendees?.length ?? 0) > 0,
    key: {
      accountId: event.accountId,
      calendarId: event.calendarId,
      eventId: event.eventId,
    },
    responseStatus,
    title: title.length > 0 ? title : "Untitled event",
  });
};

const includedInPublication = (
  event: AgendaEventValue,
  preferences: DesktopPreferencesValue,
  now: number,
  until: number
): boolean =>
  event.end > now &&
  event.start < until &&
  (!event.allDay || preferences.includeAllDay) &&
  (event.hasParticipants || preferences.includeWithoutParticipants) &&
  (event.conferenceUrl !== null ||
    event.hasLocation ||
    preferences.includeWithoutConferencingOrLocation);

export const agendaSnapshot = (
  model: AppModel,
  preferences: DesktopPreferencesValue
): AgendaSnapshotValue => {
  if (
    !preferences.menuBar ||
    Option.isNone(model.person) ||
    Option.isNone(model.upcoming.query) ||
    model.upcoming.query.value.personId !== model.person.value
  ) {
    return { events: [] };
  }

  const selected = new Set(
    upcomingSelection(model).map((ref) =>
      calendarKey(ref.accountId, ref.calendarId)
    )
  );

  const calendars = new Map(
    model.calendar.calendars.map((calendar) => [
      calendarKey(calendar.accountId, calendar.calendarId),
      calendar,
    ])
  );

  const rows =
    Option.getOrUndefined(AsyncData.getData(model.upcoming.data))?.events ?? [];

  const until = model.calendar.now + agendaHorizonMilliseconds(preferences);
  const seen = new Set<string>();
  const events: AgendaEventValue[] = [];

  for (const event of rows) {
    const ref = calendarKey(event.accountId, event.calendarId);

    if (!selected.has(ref)) {
      continue;
    }

    const projected = projectSavedEvent(
      event,
      model.calendar.zone,
      calendars.get(ref)?.backgroundColor ?? "#64748b"
    );

    if (
      Option.isNone(projected) ||
      !includedInPublication(
        projected.value,
        preferences,
        model.calendar.now,
        until
      ) ||
      seen.has(event.eventId)
    ) {
      continue;
    }

    seen.add(event.eventId);
    events.push(projected.value);
  }

  return {
    events: events.toSorted(
      (left, right) =>
        left.start - right.start ||
        left.key.eventId.localeCompare(right.key.eventId)
    ),
  };
};
