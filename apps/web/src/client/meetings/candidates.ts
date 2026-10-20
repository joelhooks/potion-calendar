import type {
  CalendarEventValue,
  CalendarValue,
} from "@calendar/calendar/contracts";
import { DateTime, Option } from "effect";

import { conferenceLink } from "../../layout/conferencing.js";
import { mergeEquivalentEvents } from "../../layout/equivalent-events.js";
import { displayEvent } from "../../layout/presentation.js";
import type { DisplayEvent } from "../../layout/presentation.js";
import { calendarKey } from "../calendar-state.js";
import type { UpcomingMeetingMinutes } from "../settings/model.js";

export interface MeetingInput {
  readonly events: readonly CalendarEventValue[];
  readonly calendars: readonly CalendarValue[];
  readonly hidden: readonly string[];
  readonly accounts: readonly string[];
  readonly primaryAccount: string | undefined;
  readonly zone: string;
}

export interface MeetingCandidate {
  readonly item: DisplayEvent;
  readonly start: number;
  readonly end: number;
  readonly conferenceUrl: string | undefined;
}

export const meetingCandidates = (
  input: MeetingInput
): readonly MeetingCandidate[] => {
  const displayed = input.events.flatMap((event) => {
    const calendar = input.calendars.find(
      (entry) =>
        entry.accountId === event.accountId &&
        entry.calendarId === event.calendarId
    );

    if (
      calendar === undefined ||
      calendar.accessRole === "freeBusyReader" ||
      input.hidden.includes(calendarKey(event.accountId, event.calendarId)) ||
      event.status === "cancelled" ||
      event.start === undefined ||
      !("dateTime" in event.start) ||
      event.end === undefined ||
      !("dateTime" in event.end) ||
      (event.attendees?.length ?? 0) === 0 ||
      event.attendees?.some(
        (attendee) =>
          attendee.self === true && attendee.responseStatus === "declined"
      ) === true
    ) {
      return [];
    }

    const item = displayEvent(event, calendar, input.zone, Option.none());

    return item === undefined ? [] : [item];
  });

  return mergeEquivalentEvents(displayed, input.accounts, input.primaryAccount)
    .flatMap((item) => {
      const { source } = item;

      if (
        source.start === undefined ||
        !("dateTime" in source.start) ||
        source.end === undefined ||
        !("dateTime" in source.end)
      ) {
        return [];
      }

      const start = DateTime.makeZoned(source.start.dateTime);
      const end = DateTime.makeZoned(source.end.dateTime);

      if (Option.isNone(start) || Option.isNone(end)) {
        return [];
      }

      const startMillis = DateTime.toEpochMillis(start.value);
      const endMillis = DateTime.toEpochMillis(end.value);

      return endMillis <= startMillis
        ? []
        : [
            {
              conferenceUrl: conferenceLink(
                source.conferenceUrl,
                source.location,
                source.description
              ),
              end: endMillis,
              item,
              start: startMillis,
            },
          ];
    })
    .toSorted(
      (left, right) =>
        left.start - right.start || left.item.key.localeCompare(right.item.key)
    );
};

export const contextMeeting = (
  candidates: readonly MeetingCandidate[],
  now: number,
  horizonMinutes: typeof UpcomingMeetingMinutes.Type
): MeetingCandidate | undefined =>
  candidates.find(
    (candidate) =>
      candidate.start > now && candidate.start <= now + horizonMinutes * 60_000
  );

export const nextJoinMeeting = (
  candidates: readonly MeetingCandidate[],
  now: number,
  horizonMinutes: typeof UpcomingMeetingMinutes.Type
): MeetingCandidate | undefined =>
  candidates.findLast(
    (candidate) =>
      candidate.start <= now &&
      candidate.end > now &&
      candidate.conferenceUrl !== undefined
  ) ??
  contextMeeting(
    candidates.filter((candidate) => candidate.conferenceUrl !== undefined),
    now,
    horizonMinutes
  );
