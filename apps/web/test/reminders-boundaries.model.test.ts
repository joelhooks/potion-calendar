import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Option } from "effect";

import { reminderCandidates } from "../src/client/reminders/candidates.js";
import {
  initialReminderState,
  stepReminder,
} from "../src/client/reminders/machine.js";
import {
  candidatesFor,
  reminderCalendars,
  reminderEpoch,
  reminderEvent,
  reminderInstant,
  scanReminders,
  startedReminders,
} from "./reminders-fixture.js";

it.effect(
  "a first live snapshot after permission was checked while loading still baselines ten invites quietly",
  () =>
    Effect.sync(() => {
      let state = stepReminder(initialReminderState(), {
        now: reminderEpoch,
        type: "START",
      });

      state = scanReminders(state, 0, {
        accepted: Option.none(),
        candidates: [],
      });
      state = stepReminder(state, {
        now: reminderEpoch,
        permission: "granted",
        type: "PERMISSION",
      });
      state = scanReminders(state, 1, {
        accepted: Option.none(),
        candidates: [],
      });

      const candidates = candidatesFor(
        Array.from({ length: 10 }, (_, index) =>
          reminderEvent(index, {
            attendees: [
              {
                email: "fixture@example.test",
                responseStatus: "needsAction",
                self: true,
              },
            ],
            reminders: { overrides: [], useDefault: false },
          })
        )
      );

      state = scanReminders(state, 2, {
        accepted: Option.some({ origin: "live", request: 1 }),
        candidates,
      });
      expect(state.context.deliveries).toHaveLength(0);
      expect(Object.keys(state.context.invitations)).toHaveLength(10);
    })
);

it.effect(
  "a backward clock cannot fire a late-discovered offset from an accepted refresh",
  () =>
    Effect.sync(() => {
      let state = scanReminders(startedReminders(), 0, { candidates: [] });
      state = scanReminders(state, 120, { candidates: [] });

      const candidates = candidatesFor([
        reminderEvent(0, { start: { dateTime: reminderInstant(100) } }),
      ]);

      state = scanReminders(state, 90, {
        accepted: Option.some({ origin: "snapshot", request: 2 }),
        candidates,
      });
      expect(state.context.deliveries).toHaveLength(0);
      expect(Option.getOrUndefined(state.context.lastChecked)).toBe(
        reminderEpoch + 120 * 60_000
      );
    })
);

it.effect(
  "declined primary copies cannot suppress an eligible accepted duplicate",
  () =>
    Effect.sync(() => {
      const original = reminderEvent(0, {
        attendees: [
          {
            email: "fixture@example.test",
            responseStatus: "declined",
            self: true,
          },
        ],
        reminders: { useDefault: true },
      });

      const copy = {
        ...original,
        accountId: "other",
        attendees: [
          {
            email: "other@example.test",
            responseStatus: "accepted" as const,
            self: true,
          },
        ],
        calendarId: "shared",
        eventId: "copy",
      };

      const candidates = candidatesFor([original, copy]);
      const state = scanReminders(startedReminders(), 15, { candidates });
      expect(state.context.deliveries).toHaveLength(1);
      expect(state.context.deliveries[0]?.candidate.calendar.accountId).toBe(
        "other"
      );
    })
);

it.effect(
  "missing reminder facts do not silently select calendar defaults",
  () =>
    Effect.sync(() => {
      const candidates = candidatesFor([
        reminderEvent(0, { reminders: undefined }),
      ]);

      expect(
        scanReminders(startedReminders(), 55, { candidates }).context.deliveries
      ).toHaveLength(0);
    })
);

it.effect(
  "date-only reminder offsets use the saved calendar's local midnight",
  () =>
    Effect.sync(() => {
      const event = reminderEvent(0, {
        end: { date: "2026-10-22" },
        reminders: { useDefault: true },
        start: { date: "2026-10-21" },
      });

      const candidates = reminderCandidates({
        accounts: ["person", "other"],
        calendars: reminderCalendars.map((calendar) => ({
          ...calendar,
          timeZone: "Asia/Tokyo",
        })),
        events: [event],
        format: "24",
        hidden: [],
        now: reminderEpoch,
        primaryAccount: "person",
        zone: "UTC",
      });

      expect(candidates[0]?.start).toBe(
        DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-20T15:00:00.000Z"))
      );
      expect(
        scanReminders(startedReminders(), 885, { candidates }).context
          .deliveries
      ).toHaveLength(1);
    })
);

it.effect(
  "the shared thirty-day source covers a maximum offset at the four-week boundary",
  () =>
    Effect.sync(() => {
      const candidates = candidatesFor([
        reminderEvent(0, {
          end: { dateTime: reminderInstant(40_381) },
          reminders: {
            overrides: [{ method: "popup", minutes: 40_320 }],
            useDefault: false,
          },
          start: { dateTime: reminderInstant(40_321) },
        }),
      ]);

      let state = scanReminders(startedReminders(), 0, { candidates });
      expect(state.context.deliveries).toHaveLength(0);
      state = scanReminders(state, 1, { candidates });
      expect(state.context.deliveries).toHaveLength(1);
    })
);

it.effect(
  "invitation comparisons include saved events beyond the popup horizon",
  () =>
    Effect.sync(() => {
      let state = scanReminders(startedReminders(), 0, { candidates: [] });

      const candidates = candidatesFor([
        reminderEvent(29, {
          attendees: [
            {
              email: "fixture@example.test",
              responseStatus: "needsAction",
              self: true,
            },
          ],
          end: { dateTime: reminderInstant(29 * 1440 + 60) },
          start: { dateTime: reminderInstant(29 * 1440) },
        }),
      ]);

      state = scanReminders(state, 1, {
        accepted: Option.some({ origin: "live", request: 2 }),
        candidates,
      });
      expect(
        state.context.deliveries.map((notification) => notification.title)
      ).toEqual(["Invite: Meeting 29"]);
    })
);

it.effect(
  "active notifications follow a saved end-time extension without another reminder",
  () =>
    Effect.sync(() => {
      let state = scanReminders(startedReminders(), 50);

      const candidates = candidatesFor([
        reminderEvent(0, { end: { dateTime: reminderInstant(2000) } }),
      ]);

      state = scanReminders(state, 100, {
        accepted: Option.some({ origin: "snapshot", request: 2 }),
        candidates,
      });
      expect(state.context.deliveries).toHaveLength(0);
      state = scanReminders(state, 1440, { candidates });
      expect(state.context.active).toHaveLength(1);
      expect(state.context.close).toHaveLength(0);
      state = scanReminders(state, 2000, { candidates });
      expect(state.context.active).toHaveLength(0);
      expect(state.context.close).toHaveLength(1);
    })
);
