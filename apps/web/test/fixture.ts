import {
  CalendarEvent,
  ListCalendarsOutput,
  Revoked,
} from "@calendar/calendar/contracts";
import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { SessionSnapshot } from "@calendar/core/contracts";
import { DateTime, Option, Schema } from "effect";

import { RemoteSession, initialModel } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import {
  RemoteCalendars,
  RemoteEvents,
  calendarKey,
  eventKey,
} from "../src/client/calendar-state.js";

const timed = (
  id: string,
  title: string,
  day: string,
  start: string,
  end: string,
  extra: Partial<CalendarEventValue> = {}
): CalendarEventValue =>
  Schema.decodeSync(CalendarEvent)({
    accountId: "work",
    attachments: [],
    calendarId: "primary",
    end: { dateTime: `${day}T${end}:00-07:00` },
    eventId: id,
    start: { dateTime: `${day}T${start}:00-07:00` },
    status: "confirmed",
    title,
    ...extra,
  });

export const fixtureEvents = [
  timed("a-review", "Product review", "2026-10-19", "09:00", "10:00", {
    attendees: [
      {
        displayName: "You",
        email: "owner@example.test",
        responseStatus: "accepted",
        self: true,
      },
      {
        displayName: "Alex",
        email: "alex@example.test",
        organizer: true,
        responseStatus: "accepted",
      },
    ],
    conferenceUrl: "https://meet.google.com/abc-defg-hij",
    description: "Review the week and choose the next small release.",
    location: "Studio",
  }),
  timed("b-design", "Design session", "2026-10-19", "09:00", "10:00", {
    colorId: "3",
  }),
  timed("focus", "Focus time", "2026-10-20", "08:30", "10:30", {
    colorId: "10",
  }),
  timed("declined", "Optional planning", "2026-10-20", "11:00", "12:00", {
    attendees: [
      { email: "owner@example.test", responseStatus: "declined", self: true },
    ],
    colorId: "4",
  }),
  timed("unanswered", "Project catch-up", "2026-10-21", "11:00", "12:00", {
    attendees: [
      {
        email: "owner@example.test",
        responseStatus: "needsAction",
        self: true,
      },
    ],
  }),
  timed("tentative", "Lunch with Sam", "2026-10-22", "12:00", "13:00", {
    accountId: "personal",
    calendarId: "personal",
    colorId: "6",
    status: "tentative",
  }),
  timed("late", "Release notes", "2026-10-23", "14:00", "15:00", {
    colorId: "10",
  }),
  timed("hidden", "Hidden calendar secret", "2026-10-21", "09:00", "10:00", {
    calendarId: "hidden",
  }),
  timed("cancelled", "Cancelled meeting", "2026-10-21", "13:00", "14:00", {
    status: "cancelled",
  }),
  Schema.decodeSync(CalendarEvent)({
    accountId: "work",
    attachments: [],
    calendarId: "primary",
    end: { date: "2026-10-24" },
    eventId: "week-project",
    start: { date: "2026-10-19" },
    status: "confirmed",
    title: "Ship the calendar",
  }),
  Schema.decodeSync(CalendarEvent)({
    accountId: "personal",
    attachments: [],
    calendarId: "personal",
    end: { date: "2026-10-22" },
    eventId: "home",
    start: { date: "2026-10-21" },
    status: "confirmed",
    title: "At home",
  }),
];

export const fixtureIndex = Schema.decodeSync(ListCalendarsOutput)({
  accounts: [
    {
      accountId: "work",
      calendars: [
        {
          accessRole: "owner",
          accountId: "work",
          backgroundColor: "#4986E8",
          calendarId: "primary",
          primary: true,
          selected: true,
          timeZone: "America/Los_Angeles",
          title: "Work",
        },
        {
          accessRole: "reader",
          accountId: "work",
          backgroundColor: "#B8B8B8",
          calendarId: "hidden",
          primary: false,
          selected: true,
          timeZone: "America/Los_Angeles",
          title: "Shared calendar",
        },
      ],
      colors: { calendar: {}, event: {} },
    },
    {
      accountId: "personal",
      calendars: [
        {
          accessRole: "owner",
          accountId: "personal",
          backgroundColor: "#5ECC89",
          calendarId: "personal",
          primary: true,
          selected: true,
          timeZone: "America/Los_Angeles",
          title: "Personal",
        },
      ],
      colors: { calendar: {}, event: {} },
    },
    { accountId: "revoked", failure: new Revoked({ accountId: "revoked" }) },
  ],
});

export const fixtureModel = (): AppModel => {
  const now = DateTime.toEpochMillis(
    DateTime.makeUnsafe("2026-10-21T10:30:00-07:00")
  );

  const model = initialModel(now, "America/Los_Angeles");

  return {
    ...model,
    calendar: {
      ...model.calendar,
      calendars: fixtureIndex.accounts.flatMap((account) =>
        "calendars" in account ? account.calendars : []
      ),
      hidden: [calendarKey("work", "hidden")],
      index: RemoteCalendars.Success({ data: fixtureIndex }),
      rangeRequest: 1,
      reads: ["work", "personal"].map((accountId) => ({
        accountId,
        events: RemoteEvents.Success({
          data: {
            events: fixtureEvents.filter(
              (event) => event.accountId === accountId
            ),
            versions: [],
          },
        }),
      })),
      selected: [],
      viewport: 844,
      viewportWidth: 1220,
      visibility: { [calendarKey("work", "hidden")]: false },
    },
    person: Option.some("fixture-person"),
    session: RemoteSession.Success({
      data: Schema.decodeSync(SessionSnapshot)({
        accounts: [
          { disconnected: false, email: "owner@example.test", id: "work" },
          {
            disconnected: false,
            email: "personal@example.test",
            id: "personal",
          },
          {
            disconnected: true,
            email: "reconnect@example.test",
            id: "revoked",
          },
        ],
        user: {
          email: "owner@example.test",
          id: "fixture-person",
          name: "Calendar owner",
        },
      }),
    }),
  };
};

export const fixtureSelection = (): AppModel => {
  const model = fixtureModel();
  const [event] = fixtureEvents;

  return event === undefined
    ? model
    : {
        ...model,
        calendar: {
          ...model.calendar,
          selected: [eventKey(event)],
          viewportWidth: 920,
        },
      };
};
