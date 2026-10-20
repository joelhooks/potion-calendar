import { CalendarEvent } from "@calendar/calendar/contracts";
import { DateTime } from "effect";

import { Message, update } from "../src/client/app.js";
import type { MeetingInput } from "../src/client/meetings/candidates.js";
import { editorCalendars } from "./editor-fixture.js";
import { upcomingFixture, upcomingPerson } from "./upcoming-fixture.js";

export const meetingEpoch = DateTime.toEpochMillis(
  DateTime.makeUnsafe("2026-10-20T12:00:00.000Z")
);

export const meetingInstant = (minutes: number): string =>
  DateTime.formatIso(DateTime.makeUnsafe(meetingEpoch + minutes * 60_000));

export const savedMeeting = (
  index: number,
  start: number,
  end: number,
  changes: Partial<typeof CalendarEvent.Type> = {}
): typeof CalendarEvent.Type =>
  CalendarEvent.make({
    accountId: "work",
    attendees: [
      { email: "person@example.test", responseStatus: "accepted", self: true },
      { email: "guest@example.test", responseStatus: "needsAction" },
    ],
    calendarId: "primary",
    conferenceUrl: "https://meet.google.com/abc-defg-hij",
    end: { dateTime: meetingInstant(end) },
    eventId: `meeting-${index}`,
    iCalUID: `meeting-${index}@example.test`,
    start: { dateTime: meetingInstant(start) },
    status: "confirmed",
    title: `Meeting ${index}`,
    ...changes,
  });

export const meetingModel = (
  events: readonly (typeof CalendarEvent.Type)[]
) => {
  const base = upcomingFixture();

  return update(
    base,
    Message.ReceivedUpcoming({
      personId: upcomingPerson,
      request: base.upcoming.request,
      result: { events, versions: [] },
    })
  ).model;
};

export const meetingInput = (
  events: readonly (typeof CalendarEvent.Type)[],
  changes: Partial<MeetingInput> = {}
): MeetingInput => ({
  accounts: ["work", "personal"],
  calendars: editorCalendars,
  events,
  hidden: [],
  primaryAccount: "work",
  zone: "UTC",
  ...changes,
});
