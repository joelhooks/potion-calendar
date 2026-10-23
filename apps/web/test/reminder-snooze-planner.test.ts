import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  candidatesFor,
  reminderEpoch,
  reminderEvent,
  reminderInstant,
  scanReminders,
  startedReminders,
} from "./reminders-fixture.js";

it.effect.each([1, 5, 15, 30, 60, 1440])(
  "a pending %s-minute snooze fires once at its deadline and survives the event ending",
  (minutes) =>
    Effect.sync(() => {
      const candidates = candidatesFor([reminderEvent(0)]);
      const [candidate] = candidates;
      expect(candidate).toBeDefined();

      if (candidate === undefined) {
        return;
      }

      const before = scanReminders(
        scanReminders(startedReminders(), 0, { candidates, webCards: true }),
        50,
        { candidates, webCards: true }
      );

      expect(before.context.active).toHaveLength(1);
      const due = reminderEpoch + (50 + minutes) * 60_000;

      const context = {
        ...before.context,
        active: [],
        snoozes: [{ due, identity: candidate.identity }],
      };

      const pending = { ...before, context };

      const early = scanReminders(pending, 50 + minutes - 1 / 60_000, {
        candidates,
        webCards: true,
      });

      expect(early.context.deliveries).toEqual([]);

      const fired = scanReminders(early, 50 + minutes, {
        candidates,
        webCards: true,
      });

      expect(fired.context.deliveries).toHaveLength(1);
      expect(fired.context.deliveries[0]).toMatchObject({
        candidate: { body: candidate.body, title: candidate.title },
        card: { kind: "reminder", snoozedUntil: due, state: "active" },
        id: JSON.stringify(["snooze", candidate.identity, due]),
      });
      expect(fired.context).toMatchObject({ snoozes: [] });

      const repeated = scanReminders(fired, 50 + minutes, {
        candidates,
        webCards: true,
      });

      const later = scanReminders(repeated, 50 + minutes + 1, {
        candidates,
        webCards: true,
      });

      expect(repeated.context.deliveries).toEqual([]);
      expect(later.context.deliveries).toEqual([]);
      expect(later.context.active).toHaveLength(1);
    })
);

it.effect(
  "Until start suppresses intermediate offsets and wins a simultaneous start offset with one card",
  () =>
    Effect.sync(() => {
      const candidates = candidatesFor([
        reminderEvent(0, {
          reminders: {
            overrides: [10, 5, 0].map((minutes) => ({
              method: "popup",
              minutes,
            })),
            useDefault: false,
          },
        }),
      ]);

      const [candidate] = candidates;
      expect(candidate).toBeDefined();

      if (candidate === undefined) {
        return;
      }

      const before = scanReminders(
        scanReminders(startedReminders(), 0, { candidates, webCards: true }),
        50,
        { candidates, webCards: true }
      );

      const context = {
        ...before.context,
        active: [],
        snoozes: [{ due: candidate.start, identity: candidate.identity }],
      };

      const waiting = scanReminders({ ...before, context }, 55, {
        candidates,
        webCards: true,
      });

      expect(waiting.context.deliveries).toEqual([]);
      const fired = scanReminders(waiting, 60, { candidates, webCards: true });
      expect(fired.context.deliveries).toHaveLength(1);
      expect(fired.context.active).toHaveLength(1);
      expect(fired.context.deliveries[0]).toMatchObject({
        card: { snoozedUntil: candidate.start },
        id: JSON.stringify(["snooze", candidate.identity, candidate.start]),
      });
    })
);

it.effect.each(["unresolved", "cancelled", "declined"] as const)(
  "a due snooze drops a %s event without a delivery",
  (reason) =>
    Effect.sync(() => {
      const [candidate] = candidatesFor([reminderEvent(0)]);
      expect(candidate).toBeDefined();

      if (candidate === undefined) {
        return;
      }

      const before = scanReminders(startedReminders(), 0, { webCards: true });

      const context = {
        ...before.context,
        snoozes: [
          { due: reminderEpoch + 60_000, identity: candidate.identity },
        ],
      };

      const events =
        reason === "unresolved"
          ? []
          : [
              reminderEvent(
                0,
                reason === "cancelled"
                  ? { status: "cancelled" }
                  : {
                      attendees: [
                        {
                          email: "person@example.test",
                          responseStatus: "declined",
                          self: true,
                        },
                      ],
                    }
              ),
            ];

      const result = scanReminders({ ...before, context }, 1, {
        candidates: candidatesFor(events),
        webCards: true,
      });

      expect(result.context.deliveries).toEqual([]);
      expect(result.context).toMatchObject({ snoozes: [] });
    })
);

it.effect(
  "accepted resolved snoozes fire while only unresolved identities wait for expanded read coverage",
  () =>
    Effect.sync(() => {
      const candidates = candidatesFor([reminderEvent(0)]);
      const [candidate] = candidates;

      if (candidate === undefined) {
        throw new Error("Missing reminder candidate");
      }

      const before = scanReminders(startedReminders(), 0, {
        candidates,
        webCards: true,
      });

      const known = {
        due: reminderEpoch + 60_000,
        identity: candidate.identity,
      };

      const missing = { due: known.due, identity: "unresolved" };
      const context = { ...before.context, snoozes: [known, missing] };

      const fired = scanReminders({ ...before, context }, 1, {
        candidates,
        snoozeRangeReady: false,
        webCards: true,
      });

      expect(fired.context.deliveries).toHaveLength(1);
      expect(fired.context).toMatchObject({ snoozes: [missing] });

      const accepted = scanReminders(fired, 1, {
        candidates,
        snoozeRangeReady: true,
        webCards: true,
      });

      expect(accepted.context.deliveries).toEqual([]);
      expect(accepted.context).toMatchObject({ snoozes: [] });
    })
);

it.effect(
  "a snoozed reminder remains active past event end while an ordinary card closes",
  () =>
    Effect.sync(() => {
      const candidates = candidatesFor([
        reminderEvent(0, { end: { dateTime: reminderInstant(61) } }),
      ]);

      const ordinary = scanReminders(
        scanReminders(startedReminders(), 0, { candidates, webCards: true }),
        50,
        { candidates, webCards: true }
      );

      const context = {
        ...ordinary.context,
        active: ordinary.context.active.map((notification) => ({
          ...notification,
          card: {
            kind: "reminder" as const,
            snoozedUntil: reminderEpoch + 50 * 60_000,
            state: "active" as const,
          },
        })),
      };

      const expired = scanReminders(ordinary, 62, {
        candidates,
        webCards: true,
      });

      const retained = scanReminders({ ...ordinary, context }, 62, {
        candidates,
        webCards: true,
      });

      expect(expired.context.active).toEqual([]);
      expect(retained.context.active).toHaveLength(1);
      expect(retained.context.close).toEqual([]);
    })
);
