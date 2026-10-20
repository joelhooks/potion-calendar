import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { stepReminder } from "../src/client/reminders/machine.js";
import {
  candidatesFor,
  reminderEpoch,
  reminderEvent,
  reminderInstant,
  scanReminders,
  startedReminders,
} from "./reminders-fixture.js";

it.effect(
  "ten existing pending invitations baseline quietly, including a first live-origin read",
  () =>
    Effect.sync(() => {
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

      let state = scanReminders(startedReminders(), 0, {
        accepted: Option.some({ origin: "live", request: 1 }),
        candidates,
      });

      expect(state.context.deliveries).toHaveLength(0);
      state = scanReminders(state, 1, {
        accepted: Option.some({ origin: "live", request: 2 }),
        candidates,
      });
      expect(state.context.deliveries).toHaveLength(0);

      const reload = scanReminders(startedReminders(), 2, {
        accepted: Option.some({ origin: "live", request: 3 }),
        candidates,
      });

      expect(reload.context.deliveries).toHaveLength(0);
    })
);

it.effect(
  "a new invitation uses the no-title fallback once and selection changes re-baseline",
  () =>
    Effect.sync(() => {
      let state = scanReminders(startedReminders(), 0, { candidates: [] });

      const candidates = candidatesFor([
        reminderEvent(1, {
          attendees: [
            {
              email: "fixture@example.test",
              responseStatus: "needsAction",
              self: true,
            },
          ],
          reminders: { overrides: [], useDefault: false },
          title: " ",
        }),
      ]);

      state = scanReminders(state, 1, {
        accepted: Option.some({ origin: "live", request: 2 }),
        candidates,
      });
      expect(
        state.context.deliveries.map((notification) => notification.title)
      ).toEqual(["Invite: (No title)"]);
      state = scanReminders(state, 2, {
        accepted: Option.some({ origin: "live", request: 3 }),
        candidates,
      });
      expect(state.context.deliveries).toHaveLength(0);
      state = scanReminders(state, 3, {
        accepted: Option.none(),
        candidates: [],
        scope: "other-selection",
      });
      state = scanReminders(state, 4, {
        accepted: Option.some({ origin: "live", request: 4 }),
        candidates,
        scope: "other-selection",
      });
      expect(state.context.deliveries).toHaveLength(0);
    })
);

it.effect(
  "our RSVP and attendee-only changes do not notify; moving a saved start does",
  () =>
    Effect.sync(() => {
      const original = reminderEvent(0, {
        attendees: [
          {
            email: "fixture@example.test",
            responseStatus: "accepted",
            self: true,
          },
          { email: "other@example.test", responseStatus: "needsAction" },
        ],
        etag: "initial",
        reminders: { overrides: [], useDefault: false },
      });

      let state = scanReminders(startedReminders(), 0, {
        candidates: candidatesFor([original]),
      });

      const ownResponse = {
        ...original,
        attendees: original.attendees?.map((attendee) =>
          attendee.self === true
            ? { ...attendee, responseStatus: "tentative" as const }
            : attendee
        ),
        etag: "own-rsvp",
      };

      state = scanReminders(state, 1, {
        accepted: Option.some({ origin: "live", request: 2 }),
        candidates: candidatesFor([ownResponse]),
      });
      expect(state.context.deliveries).toHaveLength(0);

      const attendeeResponse = {
        ...ownResponse,
        attendees: ownResponse.attendees?.map((attendee) =>
          attendee.self === true
            ? attendee
            : { ...attendee, responseStatus: "accepted" as const }
        ),
        etag: "attendee-rsvp",
      };

      state = scanReminders(state, 2, {
        accepted: Option.some({ origin: "live", request: 3 }),
        candidates: candidatesFor([attendeeResponse]),
      });
      expect(state.context.deliveries).toHaveLength(0);

      const moved = {
        ...attendeeResponse,
        etag: "moved",
        start: { dateTime: reminderInstant(90) },
      };

      state = scanReminders(state, 3, {
        accepted: Option.some({ origin: "live", request: 4 }),
        candidates: candidatesFor([moved]),
      });
      expect(
        state.context.deliveries.map((notification) => notification.title)
      ).toEqual(["Invite: Meeting 0"]);
      state = scanReminders(state, 4, {
        accepted: Option.some({ origin: "live", request: 5 }),
        candidates: candidatesFor([{ ...moved, etag: "reread" }]),
      });
      expect(state.context.deliveries).toHaveLength(0);
      state = scanReminders(state, 5, {
        accepted: Option.some({ origin: "live", request: 6 }),
        candidates: candidatesFor([attendeeResponse]),
      });
      expect(state.context.deliveries).toHaveLength(1);
      state = scanReminders(state, 6, {
        accepted: Option.some({ origin: "live", request: 7 }),
        candidates: candidatesFor([moved]),
      });
      expect(state.context.deliveries).toHaveLength(1);
    })
);

it.effect(
  "the invitation toggle consumes baselines without disabling popup reminders",
  () =>
    Effect.sync(() => {
      let state = scanReminders(startedReminders(), 0, { candidates: [] });

      const candidates = candidatesFor([
        reminderEvent(1, {
          attendees: [
            {
              email: "fixture@example.test",
              responseStatus: "needsAction",
              self: true,
            },
          ],
        }),
      ]);

      state = scanReminders(state, 10, {
        accepted: Option.some({ origin: "live", request: 2 }),
        candidates,
        eventInvites: false,
      });
      expect(state.context.deliveries).toHaveLength(0);
      state = scanReminders(state, 50, {
        accepted: Option.some({ origin: "snapshot", request: 3 }),
        candidates,
        eventInvites: false,
      });
      expect(
        state.context.deliveries.map((notification) => notification.title)
      ).toEqual(["Meeting 1"]);
      state = scanReminders(state, 51, {
        accepted: Option.some({ origin: "live", request: 4 }),
        candidates,
        eventInvites: true,
      });
      expect(state.context.deliveries).toHaveLength(0);
    })
);

it.effect(
  "denial and stopping close active notifications and re-grant never replays old offsets",
  () =>
    Effect.sync(() => {
      let state = scanReminders(startedReminders(), 50);
      state = stepReminder(state, {
        now: reminderEpoch + 51 * 60_000,
        permission: "denied",
        type: "PERMISSION",
      });
      expect(state.context.close).toHaveLength(1);
      expect(state.context.active).toHaveLength(0);
      state = scanReminders(state, 51);
      expect(state.context.deliveries).toHaveLength(0);
      state = stepReminder(state, {
        now: reminderEpoch + 60 * 60_000,
        permission: "granted",
        type: "PERMISSION",
      });
      state = scanReminders(state, 60);
      expect(state.context.deliveries).toHaveLength(0);
      state = scanReminders(state, 80, {
        candidates: candidatesFor([
          reminderEvent(1, { start: { dateTime: reminderInstant(90) } }),
        ]),
      });
      expect(state.context.deliveries).toHaveLength(1);
      state = stepReminder(state, { type: "STOP" });
      expect(state.value).toBe("stopped");
      expect(state.context.close).toHaveLength(1);
      expect(scanReminders(state, 90).context.deliveries).toHaveLength(0);
    })
);
