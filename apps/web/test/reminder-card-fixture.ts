import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { Option } from "effect";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import {
  NotificationEvent,
  ReminderSnoozeRestore,
} from "../src/client/reminders/model.js";
import type { NotificationPermission } from "../src/client/reminders/model.js";
import {
  savedUpcomingEvent,
  upcomingFixture,
  upcomingNow,
  upcomingPerson,
} from "./upcoming-fixture.js";

export type ReminderCardScene = "prompt" | "reminder" | "hidden-tab";

export const reminderCardScene = (
  scene: ReminderCardScene,
  theme: "light" | "dark",
  width: number,
  permission: typeof NotificationPermission.Type = "granted",
  availability: AppModel["desktop"]["availability"] = "unavailable",
  snoozeRestore: "ready" | "failed" | "loading" = "ready"
) => {
  const base = upcomingFixture();

  const event: CalendarEventValue = {
    ...savedUpcomingEvent,
    attendees:
      scene === "reminder"
        ? []
        : [{ email: "guest@example.test", responseStatus: "accepted" }],
    conferenceUrl:
      scene === "reminder" ? undefined : "https://meet.google.com/aaa-bbbb-ccc",
    end: { dateTime: "2026-10-20T12:32:00.000Z" },
    reminders: {
      overrides: [{ method: "popup", minutes: 1 }],
      useDefault: false,
    },
    start: { dateTime: "2026-10-20T12:02:00.000Z" },
    title:
      scene === "reminder" ? "Read the project brief" : "Weekly project review",
  };

  const ready: AppModel = {
    ...base,
    calendar: { ...base.calendar, viewportWidth: width - 520 },
    desktop: { ...base.desktop, availability },
    settings: { ...base.settings, theme },
  };

  const accepted = update(
    ready,
    Message.ReceivedUpcoming({
      personId: upcomingPerson,
      request: ready.upcoming.request,
      result: { events: [event], versions: [] },
    })
  ).model;

  const restoreOutcome =
    snoozeRestore === "failed"
      ? ReminderSnoozeRestore.cases.Failed.make({})
      : ReminderSnoozeRestore.cases.Restored.make({ entries: [] });

  const restored =
    snoozeRestore === "loading"
      ? accepted
      : update(
          accepted,
          Message.ReminderSnoozesRestored({
            outcome: restoreOutcome,
            personId: upcomingPerson,
          })
        ).model;

  const permitted = update(
    restored,
    Message.ObservedNotification({
      event: NotificationEvent.cases.Permission.make({
        permission,
        personId: upcomingPerson,
      }),
      now: upcomingNow,
    })
  ).model;

  const due = update(permitted, Message.Ticked({ now: upcomingNow + 60_000 }));

  return {
    ...due,
    before: permitted,
    model: { ...due.model, person: Option.some(upcomingPerson) },
  };
};
