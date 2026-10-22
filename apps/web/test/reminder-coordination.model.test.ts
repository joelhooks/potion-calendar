import { expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { resolveReminderCard } from "../src/client/reminders/action-machine.js";
import type { ReminderCard } from "../src/client/reminders/model.js";
import {
  candidatesFor,
  reminderEvent,
  scanReminders,
  startedReminders,
} from "./reminders-fixture.js";

const Flags = Schema.Struct({
  browser: Schema.Boolean,
  conference: Schema.Boolean,
  participants: Schema.Boolean,
});

it.prop(
  "generated action and expiry histories keep a resolved card terminal",
  [Schema.Boolean, Schema.Array(Schema.Literals(["RESOLVE", "EXPIRE"]))],
  ([upcoming, events]) => {
    let card: typeof ReminderCard.Type = {
      kind: upcoming ? "upcoming" : "reminder",
      state: "active",
    };

    let resolved = false;

    for (const event of events) {
      resolved = true;
      card = resolveReminderCard(card, event);
      expect(card.kind).toBe(upcoming ? "upcoming" : "reminder");
      expect(card.state).toBe(resolved ? "resolved" : "active");
    }
  }
);

it.prop(
  "one browser pass selects exactly one delivery for crossed offsets, with upcoming priority only for eligible meetings",
  [Flags],
  ([{ conference, participants, browser }]) => {
    const candidates = candidatesFor([
      reminderEvent(0, {
        attendees: participants
          ? [{ email: "guest@example.test", responseStatus: "accepted" }]
          : [],
        conferenceUrl: conference
          ? "https://meet.google.com/aaa-bbbb-ccc"
          : undefined,
        reminders: {
          overrides: [
            { method: "popup", minutes: 1 },
            { method: "popup", minutes: 0 },
          ],
          useDefault: false,
        },
      }),
    ]);

    const baseline = scanReminders(startedReminders(), 58, {
      candidates,
      webCards: browser,
    });

    const next = scanReminders(baseline, 60, { candidates, webCards: browser });

    expect(next.context.deliveries).toHaveLength(browser ? 1 : 2);
    expect(next.context.fired).toHaveLength(2);

    for (const notification of next.context.deliveries) {
      if (browser) {
        expect(notification.card).toEqual({
          kind: conference && participants ? "upcoming" : "reminder",
          state: "active",
        });

        if (notification.card !== undefined) {
          const resolved = resolveReminderCard(notification.card);
          expect(resolved.state).toBe("resolved");
          expect(resolveReminderCard(resolved)).toEqual(resolved);
        }
      } else {
        expect(notification.card).toBeUndefined();
        expect(notification.title).toBe(notification.candidate.title);
      }
    }

    expect(
      scanReminders(next, 60, { candidates, webCards: browser }).context
        .deliveries
    ).toEqual([]);
  }
);

it.prop(
  "ordinary reminders outside the prompt minute keep ordinary identity and never become an independent prompt",
  [Schema.Int.check(Schema.isBetween({ maximum: 30, minimum: 2 }))],
  ([offset]) => {
    const candidates = candidatesFor([
      reminderEvent(0, {
        attendees: [
          { email: "guest@example.test", responseStatus: "accepted" },
        ],
        conferenceUrl: "https://meet.google.com/aaa-bbbb-ccc",
        reminders: {
          overrides: [{ method: "popup", minutes: offset }],
          useDefault: false,
        },
      }),
    ]);

    const baseline = scanReminders(startedReminders(), 59 - offset, {
      candidates,
      webCards: true,
    });

    const due = scanReminders(baseline, 60 - offset, {
      candidates,
      webCards: true,
    });

    expect(due.context.deliveries).toHaveLength(1);
    expect(due.context.deliveries[0]?.card?.kind).toBe("reminder");
    expect(
      scanReminders(due, 59, { candidates, webCards: true }).context.deliveries
    ).toEqual([]);
  }
);
