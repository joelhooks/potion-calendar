import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { Message, update } from "../src/client/app.js";
import { LiveNotice } from "../src/client/live/protocol.js";
import { NotificationEvent } from "../src/client/reminders/model.js";
import {
  savedUpcomingEvent,
  upcomingFixture,
  upcomingNow,
  upcomingPerson,
  upcomingSession,
} from "./upcoming-fixture.js";

it.effect(
  "the page's first live-origin success baselines ten pending invitations without notification commands",
  () =>
    Effect.sync(() => {
      let { model } = update(
        upcomingFixture(),
        Message.ObservedNotification({
          event: NotificationEvent.cases.Permission.make({
            permission: "granted",
            personId: upcomingPerson,
          }),
          now: upcomingNow,
        })
      );

      ({ model } = update(
        model,
        Message.ReceivedLive({
          notice: LiveNotice.cases.Reconnected.make({}),
          personId: upcomingPerson,
        })
      ));
      expect(Option.getOrUndefined(model.upcoming.query)?.origin).toBe("live");

      const events = Array.from({ length: 10 }, (_, index) => ({
        ...savedUpcomingEvent,
        attendees: [
          {
            email: "person@example.test",
            responseStatus: "needsAction" as const,
            self: true,
          },
        ],
        eventId: `pending-${index}`,
        iCalUID: `pending-uid-${index}`,
        organizer: { email: "organizer@example.test", self: false },
        reminders: { overrides: [], useDefault: false },
        title: `Pending invitation ${index}`,
      }));

      const result = update(
        model,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: model.upcoming.request,
          result: { events, versions: [] },
        })
      );

      expect(
        result.commands?.filter(
          (command) => command.name === "DeliverReminderNotification"
        ) ?? []
      ).toHaveLength(0);
      expect(
        Object.keys(result.model.reminders.context.invitations)
      ).toHaveLength(10);
    })
);

it.effect(
  "a same-person session refresh preserves known permission and fired keys while retiring old handles",
  () =>
    Effect.sync(() => {
      let { model } = update(
        upcomingFixture(),
        Message.ObservedNotification({
          event: NotificationEvent.cases.Permission.make({
            permission: "granted",
            personId: upcomingPerson,
          }),
          now: upcomingNow,
        })
      );

      const event = {
        ...savedUpcomingEvent,
        reminders: {
          overrides: [{ method: "popup" as const, minutes: 1259 }],
          useDefault: false,
        },
      };

      ({ model } = update(
        model,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: model.upcoming.request,
          result: { events: [event], versions: [] },
        })
      ));
      ({ model } = update(
        model,
        Message.Ticked({ now: upcomingNow + 60_000 })
      ));
      expect(model.reminders.context.active).toHaveLength(1);

      const refreshed = update(
        model,
        Message.ReceivedSession({ snapshot: upcomingSession })
      );

      expect(refreshed.model.reminders.context.permission).toBe("granted");
      expect(refreshed.model.reminders.context.fired).toEqual(
        model.reminders.context.fired
      );
      expect(refreshed.model.reminders.context.active).toHaveLength(0);
      expect(
        refreshed.commands?.some(
          (command) => command.name === "CloseReminderNotifications"
        )
      ).toBe(true);
    })
);
