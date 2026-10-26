import { conferenceLink } from "@calendar/calendar/conferencing";
import type {
  CalendarEventValue,
  EventTimeValue,
} from "@calendar/calendar/contracts";
import {
  ConferenceUrl,
  eligiblePromptAttachments,
  projectTrayDetails,
} from "@calendar/core/desktop-bridge";
import type {
  AgendaEventValue,
  AgendaSnapshotValue,
  DesktopPreferencesValue,
} from "@calendar/core/desktop-bridge";
import { DateTime, Option, Schema } from "effect";
import { AsyncData } from "foldkit";

import { participantEmail } from "../../layout/email-participants.js";
import type { ParticipantEmail } from "../../layout/email-participants.js";
import { mergeEquivalentEvents } from "../../layout/equivalent-events.js";
import { displayEvent } from "../../layout/presentation.js";
import { rsvpSelf } from "../../layout/rsvp-eligibility.js";
import type { AppModel } from "../app.js";
import { calendarKey } from "../calendar-state.js";
import { responseIsBusy } from "../editing/response-availability.js";
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

const conferenceUrl = (event: CalendarEventValue): string | null =>
  Option.getOrNull(
    Schema.decodeOption(ConferenceUrl)(
      conferenceLink(event.conferenceUrl, event.location, event.description) ??
        ""
    )
  );

const eventResponse = (
  event: CalendarEventValue
): AgendaEventValue["responseStatus"] =>
  event.attendees?.find((attendee) => attendee.self === true)?.responseStatus ??
  (event.status === "tentative" ? "tentative" : "accepted");

const projectSavedEvent = (
  event: CalendarEventValue,
  zone: string,
  calendarColor: string,
  responseBusy: boolean,
  ownEmails: readonly string[] | undefined,
  origin: string | undefined
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
  const self = rsvpSelf(event);

  const email: ParticipantEmail =
    ownEmails === undefined
      ? { kind: "disabled" }
      : participantEmail(event, ownEmails);

  const attachments = eligiblePromptAttachments(
    (event.attachments ?? []).map((attachment) => ({
      title: attachment.title ?? "Attachment",
      url: attachment.url,
    })),
    origin
  );

  const projected: AgendaEventValue = {
    ...times.value,
    attachments,
    calendarColor,
    conferenceUrl: conferenceUrl(event),
    hasLocation: (event.location?.trim().length ?? 0) > 0,
    hasParticipants: (event.attendees?.length ?? 0) > 0,
    key: {
      accountId: event.accountId,
      calendarId: event.calendarId,
      eventId: event.eventId,
    },
    participantEmails: email.kind === "ready" ? email.recipients : [],
    responseStatus,
    title: title.length > 0 ? title : "Untitled event",
    trayDetails: projectTrayDetails(event.location, attachments, email),
  };

  return Option.some(
    self === undefined
      ? projected
      : {
          ...projected,
          rsvp: {
            enabled: !responseBusy,
            response: self.responseStatus ?? null,
          },
        }
  );
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
  preferences: DesktopPreferencesValue,
  origin?: string
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

  const displayed = rows.flatMap((event) => {
    const ref = calendarKey(event.accountId, event.calendarId);

    const identity = JSON.stringify([
      event.accountId,
      event.calendarId,
      event.eventId,
    ]);

    const calendar = calendars.get(ref);

    if (
      !selected.has(ref) ||
      seen.has(identity) ||
      calendar === undefined ||
      calendar.accessRole === "freeBusyReader" ||
      event.status === "cancelled" ||
      eventResponse(event) === "declined"
    ) {
      return [];
    }

    const item = displayEvent(
      event,
      calendar,
      model.calendar.zone,
      Option.none()
    );

    if (item === undefined) {
      return [];
    }

    seen.add(identity);

    return [item];
  });

  const session = Option.getOrUndefined(AsyncData.getData(model.session));
  const accounts = session?.accounts ?? [];

  const ownEmails =
    session === undefined ||
    session === null ||
    !Option.contains(model.person, session.user.id)
      ? undefined
      : [session.user.email, ...accounts.map((account) => account.email)];

  const primary =
    accounts.find((account) => account.email === session?.user.email)?.id ??
    accounts[0]?.id;

  const merged = mergeEquivalentEvents(
    displayed,
    accounts.map((account) => account.id),
    primary
  );

  const events = merged.flatMap((item) => {
    const projected = projectSavedEvent(
      item.source,
      model.calendar.zone,
      item.calendar.backgroundColor ?? "#64748b",
      responseIsBusy(model),
      ownEmails,
      origin
    );

    return Option.isSome(projected) &&
      includedInPublication(
        projected.value,
        preferences,
        model.calendar.now,
        until
      )
      ? [projected.value]
      : [];
  });

  return {
    events: events.toSorted(
      (left, right) =>
        left.start - right.start ||
        left.key.eventId.localeCompare(right.key.eventId)
    ),
  };
};
