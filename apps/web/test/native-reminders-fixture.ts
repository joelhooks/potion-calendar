import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import type { NativeNotificationRef } from "@calendar/core/desktop-bridge";
import { Option } from "effect";

import { Message, update } from "../src/client/app.js";
import { DesktopNotice } from "../src/client/desktop/model.js";
import { reminderSnapshot } from "../src/client/reminders/source.js";
import {
  savedUpcomingEvent,
  upcomingFixture,
  upcomingPerson,
} from "./upcoming-fixture.js";

export const nativeInvite: CalendarEventValue = {
  ...savedUpcomingEvent,
  attendees: [
    { email: "person@example.test", responseStatus: "needsAction", self: true },
    { email: "guest@example.test", responseStatus: "accepted" },
  ],
  conferenceUrl: "https://meet.example.test/saved",
  end: { dateTime: "2026-10-26T10:00:00.000Z" },
  eventId: "series_20261026T090000Z",
  recurringEventId: "series",
  start: { dateTime: "2026-10-26T09:00:00.000Z" },
};

export const nativeReminderModel = (event = nativeInvite) => {
  const base = upcomingFixture();

  const ready = update(
    base,
    Message.ReceivedUpcoming({
      personId: upcomingPerson,
      request: base.upcoming.request,
      result: { events: [event], versions: [] },
    })
  ).model;

  const { model } = update(
    ready,
    Message.ReceivedDesktop({
      notice: DesktopNotice.cases.Settings.make({
        settings: {
          issues: [],
          openAtLogin: false,
          preferences: defaultDesktopPreferences(),
          revision: 1,
          runtime: {
            notificationLease: "native-lease",
            prompt: false,
            tray: true,
          },
        },
      }),
    })
  );

  const candidate = reminderSnapshot(model)?.candidates[0];

  if (candidate === undefined) {
    throw new Error("Missing native fixture candidate");
  }

  const ref: typeof NativeNotificationRef.Type = {
    generation: 1,
    id: "native-invite",
    key: {
      accountId: event.accountId,
      calendarId: event.calendarId,
      eventId: event.eventId,
    },
    kind: "invite",
    lease: "native-lease",
    personId: upcomingPerson,
    revision: model.desktop.notificationRevision ?? 0,
    start: candidate.start,
  };

  return {
    model: {
      ...model,
      person: Option.some(upcomingPerson),
      reminders: {
        ...model.reminders,
        context: {
          ...model.reminders.context,
          active: [
            {
              candidate,
              id: ref.id,
              nativeKind: "invite" as const,
              personId: upcomingPerson,
              title: "Invite: Saved meeting",
            },
          ],
        },
      },
    },
    ref,
  };
};
