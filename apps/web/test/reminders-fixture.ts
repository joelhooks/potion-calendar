import type {
  CalendarEventValue,
  CalendarValue,
} from "@calendar/calendar/contracts";
import { DateTime, Option } from "effect";

import { reminderCandidates } from "../src/client/reminders/candidates.js";
import {
  initialReminderState,
  stepReminder,
} from "../src/client/reminders/machine.js";
import type {
  ReminderScan,
  ReminderState,
} from "../src/client/reminders/model.js";

export const reminderEpoch = DateTime.toEpochMillis(
  DateTime.makeUnsafe("2026-10-20T00:00:00Z")
);

export const reminderInstant = (minutes: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(reminderEpoch + minutes * 60_000));

export const reminderCalendars: readonly CalendarValue[] = [
  {
    accessRole: "owner",
    accountId: "person",
    calendarId: "home",
    defaultReminders: [
      { method: "popup", minutes: 15 },
      { method: "email", minutes: 5 },
    ],
    primary: true,
    timeZone: "UTC",
    title: "Home",
  },
  {
    accessRole: "reader",
    accountId: "other",
    calendarId: "shared",
    defaultReminders: [{ method: "popup", minutes: 45 }],
    primary: false,
    timeZone: "UTC",
    title: "Shared",
  },
];

export const reminderEvent = (
  index: number,
  fields: Partial<CalendarEventValue> = {}
): CalendarEventValue => ({
  accountId: "person",
  calendarId: "home",
  end: { dateTime: reminderInstant(1440) },
  eventId: `event-${index}`,
  iCalUID: `uid-${index}`,
  reminders: {
    overrides: [{ method: "popup", minutes: 10 }],
    useDefault: false,
  },
  start: { dateTime: reminderInstant(60) },
  status: "confirmed",
  title: `Meeting ${index}`,
  ...fields,
});

export const candidatesFor = (
  events: readonly CalendarEventValue[],
  hidden: readonly string[] = []
) =>
  reminderCandidates({
    accounts: ["other", "person"],
    calendars: reminderCalendars,
    events,
    format: "24",
    hidden,
    now: reminderEpoch,
    primaryAccount: "person",
    zone: "UTC",
  });

export const startedReminders = (): typeof ReminderState.Type =>
  stepReminder(
    stepReminder(initialReminderState(), { now: reminderEpoch, type: "START" }),
    { now: reminderEpoch, permission: "granted", type: "PERMISSION" }
  );

export const scanReminders = (
  state: typeof ReminderState.Type,
  minutes: number,
  changes: Partial<typeof ReminderScan.Type> = {}
) =>
  stepReminder(state, {
    accepted: Option.some({
      origin: "snapshot",
      request: Option.getOrElse(state.context.accepted, () => 1),
    }),
    candidates: candidatesFor([reminderEvent(0)]),
    eventInvites: true,
    now: reminderEpoch + minutes * 60_000,
    personId: "fixture-person",
    scope: "fixture-selection",
    type: "SCAN",
    webCards: false,
    ...changes,
  });
