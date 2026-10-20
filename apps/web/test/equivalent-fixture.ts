import { CalendarEvent } from "@calendar/calendar/contracts";
import type {
  CalendarEventValue,
  CalendarRefValue,
} from "@calendar/calendar/contracts";
import { Schema } from "effect";

import type { AppModel } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { fixtureModel } from "./fixture.js";

export const copyEvent = (
  ref: CalendarRefValue,
  extra: Partial<CalendarEventValue> = {}
): CalendarEventValue =>
  Schema.decodeSync(CalendarEvent)({
    ...ref,
    end: { dateTime: "2026-10-19T10:00:00-07:00" },
    eventId: `copy-${ref.accountId}-${ref.calendarId}`,
    iCalUID: "shared-invitation@example.test",
    start: { dateTime: "2026-10-19T09:00:00-07:00" },
    status: "confirmed",
    title: "Shared planning",
    ...extra,
  });

export const copyFixtureEvents = [
  copyEvent({ accountId: "work", calendarId: "primary" }),
  copyEvent({ accountId: "personal", calendarId: "personal" }),
  copyEvent(
    { accountId: "work", calendarId: "primary" },
    { eventId: "look-alike", iCalUID: "look-alike@example.test" }
  ),
  copyEvent(
    { accountId: "work", calendarId: "primary" },
    {
      end: { date: "2026-10-22" },
      eventId: "all-day-work",
      iCalUID: "shared-all-day@example.test",
      start: { date: "2026-10-19" },
      title: "Shared conference",
    }
  ),
  copyEvent(
    { accountId: "personal", calendarId: "personal" },
    {
      end: { date: "2026-10-22" },
      eventId: "all-day-personal",
      iCalUID: "shared-all-day@example.test",
      start: { date: "2026-10-19" },
      title: "Shared conference",
    }
  ),
];

export const copyFixtureModel = (
  events: readonly CalendarEventValue[] = copyFixtureEvents
): AppModel => {
  const model = fixtureModel();

  return {
    ...model,
    calendar: {
      ...model.calendar,
      calendars: [
        ...model.calendar.calendars,
        {
          accessRole: "owner",
          accountId: "personal",
          backgroundColor: "#AC725F",
          calendarId: "other",
          primary: false,
          timeZone: "America/Los_Angeles",
          title: "Other",
        },
      ],
      hidden: [],
      reads: ["work", "personal"].map((accountId) => ({
        accountId,
        events: RemoteEvents.Success({
          data: {
            events: events.filter((event) => event.accountId === accountId),
            versions: [],
          },
        }),
      })),
    },
  };
};
