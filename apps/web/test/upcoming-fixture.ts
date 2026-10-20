import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { DateTime, Option } from "effect";

import {
  initialModel,
  Message,
  RemoteSession,
  update,
} from "../src/client/app.js";
import { calendarKey } from "../src/client/calendar-state.js";
import { editorCalendars, editorOriginal } from "./editor-fixture.js";

export const upcomingNow = DateTime.toEpochMillis(
  DateTime.makeUnsafe("2026-10-20T12:00:00.000Z")
);

export const upcomingPerson = "upcoming-person";

export const upcomingSession = {
  accounts: [{ disconnected: false, email: "person@example.test", id: "work" }],
  user: {
    email: "person@example.test",
    id: upcomingPerson,
    name: "Test Person",
  },
};

export const upcomingCalendars = {
  accounts: ["work", "personal"].map((accountId) => ({
    accountId,
    calendars: editorCalendars.filter(
      (calendar) => calendar.accountId === accountId
    ),
    colors: { calendar: {}, event: {} },
  })),
};

export const upcomingFixture = (hidden: readonly string[] = []) => {
  const model = initialModel(upcomingNow, "UTC");

  return update(
    {
      ...model,
      calendar: {
        ...model.calendar,
        hidden,
        visibility: Object.fromEntries(hidden.map((key) => [key, false])),
      },
      person: Option.some(upcomingPerson),
      session: RemoteSession.Success({ data: upcomingSession }),
    },
    Message.ReceivedCalendars({ result: upcomingCalendars })
  ).model;
};

export const upcomingKeys = editorCalendars.map((calendar) =>
  calendarKey(calendar.accountId, calendar.calendarId)
);

export const savedUpcomingEvent: CalendarEventValue = {
  ...editorOriginal,
  attendees: [],
  description: "Saved server value",
  end: { dateTime: "2026-10-21T10:00:00.000Z" },
  start: { dateTime: "2026-10-21T09:00:00.000Z" },
  title: "Saved meeting",
};

export const upcomingResult = { events: [savedUpcomingEvent], versions: [] };
