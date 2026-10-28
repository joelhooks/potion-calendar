import type {
  CalendarEventValue,
  CalendarValue,
} from "@calendar/calendar/contracts";
import { DateTime, Option } from "effect";

import { mergeEquivalentEvents } from "../../layout/equivalent-events.js";
import { dayInZone, partsFromDay } from "../../layout/navigation.js";
import { displayEvent, eventWhen } from "../../layout/presentation.js";
import type { ResolvedTimeFormat } from "../../layout/time-format.js";
import { calendarKey } from "../calendar-state.js";
import type { ReminderCandidateValue } from "./model.js";

interface CandidateInput {
  readonly events: readonly CalendarEventValue[];
  readonly calendars: readonly CalendarValue[];
  readonly hidden: readonly string[];
  readonly accounts: readonly string[];
  readonly primaryAccount: string | undefined;
  readonly zone: string;
  readonly format: ResolvedTimeFormat;
  readonly locale?: string;
  readonly now: number;
}

const eligibleSavedEvent = (
  event: CalendarEventValue,
  calendar: CalendarValue
): boolean =>
  calendar.accessRole !== "freeBusyReader" &&
  event.status !== "cancelled" &&
  event.eventType !== "focusTime" &&
  event.eventType !== "outOfOffice" &&
  event.attendees?.some(
    (attendee) =>
      attendee.self === true && attendee.responseStatus === "declined"
  ) !== true;

export const reminderCandidates = (
  input: CandidateInput
): readonly ReminderCandidateValue[] => {
  const displayed = input.events.flatMap((event) => {
    const calendar = input.calendars.find(
      (item) =>
        item.accountId === event.accountId &&
        item.calendarId === event.calendarId
    );

    if (
      calendar === undefined ||
      input.hidden.includes(calendarKey(event.accountId, event.calendarId)) ||
      !eligibleSavedEvent(event, calendar)
    ) {
      return [];
    }

    const item = displayEvent(event, calendar, input.zone, Option.none());

    return item === undefined ? [] : [item];
  });

  return mergeEquivalentEvents(
    displayed,
    input.accounts,
    input.primaryAccount
  ).flatMap((item) => {
    const sourceStart = item.source.start;
    const sourceEnd = item.source.end;

    if (sourceStart === undefined || sourceEnd === undefined) {
      return [];
    }

    const start = DateTime.makeZoned(
      "date" in sourceStart
        ? `${sourceStart.date}T00:00:00.000Z`
        : sourceStart.dateTime,
      {
        adjustForTimeZone: "date" in sourceStart,
        timeZone: item.calendar.timeZone,
      }
    );

    const end = DateTime.makeZoned(
      "date" in sourceEnd
        ? `${sourceEnd.date}T00:00:00.000Z`
        : sourceEnd.dateTime,
      {
        adjustForTimeZone: "date" in sourceEnd,
        timeZone: item.calendar.timeZone,
      }
    );

    if (Option.isNone(start) || Option.isNone(end)) {
      return [];
    }

    const timing = eventWhen(
      item,
      input.zone,
      partsFromDay(dayInZone(input.now, input.zone)).year,
      input.format,
      input.locale
    );

    const title = item.source.title?.trim() ?? "";

    return [
      {
        body: [timing.date, timing.time]
          .filter((part) => part !== undefined)
          .join(" · "),
        calendar: item.calendar,
        end: DateTime.toEpochMillis(end.value),
        event: item.source,
        identity: item.key,
        key: item.key,
        start: DateTime.toEpochMillis(start.value),
        title: title.length > 0 ? title : "(No title)",
      },
    ];
  });
};

export const eligibleNotificationEvent = (
  candidate: ReminderCandidateValue,
  now: number
): boolean =>
  candidate.end > now &&
  eligibleSavedEvent(candidate.event, candidate.calendar);

export const eligibleSnoozedReminder = (
  candidate: ReminderCandidateValue
): boolean => eligibleSavedEvent(candidate.event, candidate.calendar);

export const eligibleReminder = (
  candidate: ReminderCandidateValue,
  now: number
): boolean =>
  eligibleNotificationEvent(candidate, now) &&
  candidate.start <= now + 28 * 86_400_000;
