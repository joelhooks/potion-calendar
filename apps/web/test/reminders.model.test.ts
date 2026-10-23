import { watchActor } from "@calendar/capability/actor-watch";
import { expect, it } from "@effect/vitest";
import { createEffectActor, send } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import { Effect, Option, Queue, Schema } from "effect";

import { calendarKey } from "../src/client/calendar-state.js";
import { reminderMachine } from "../src/client/reminders/machine.js";
import type {
  NotificationContentValue,
  ReminderCandidateValue,
} from "../src/client/reminders/model.js";
import {
  candidatesFor,
  reminderEpoch,
  reminderEvent,
  reminderInstant,
  scanReminders,
  startedReminders,
} from "./reminders-fixture.js";

type Actor = EffectActor<typeof reminderMachine>;

const advance = Effect.fn("advanceReminderTest")(function* advance(
  actor: Actor,
  event: Parameters<Actor["send"]>[0]
) {
  const queue = yield* Queue.unbounded<ReturnType<Actor["getSnapshot"]>>();

  return yield* Effect.acquireUseRelease(
    Effect.sync(() =>
      actor.subscribe((snapshot) => {
        Queue.offerUnsafe(queue, snapshot);
      })
    ),
    () => send(actor, event).pipe(Effect.andThen(Queue.take(queue))),
    (subscription) =>
      Effect.sync(() => {
        subscription.unsubscribe();
      })
  );
});

it.effect(
  "offset crossings include the upper boundary once, survive clock walks, and close at the end",
  () =>
    Effect.sync(() => {
      let state = scanReminders(startedReminders(), 0);
      state = scanReminders(state, 49);
      expect(state.context.deliveries).toHaveLength(0);
      state = scanReminders(state, 50);
      expect(state.context.deliveries).toHaveLength(1);
      state = scanReminders(state, 20);
      expect(state.context.deliveries).toHaveLength(0);
      expect(Option.getOrUndefined(state.context.lastChecked)).toBe(
        reminderEpoch + 50 * 60_000
      );
      state = scanReminders(state, 120);
      expect(state.context.deliveries).toHaveLength(0);
      expect(state.context.active).toHaveLength(1);
      state = scanReminders(state, 1440);
      expect(state.context.active).toHaveLength(0);
      expect(state.context.close).toHaveLength(1);
    })
);

it.effect(
  "defaults, overrides, duplicate calendar order and email exclusion use saved facts",
  () =>
    Effect.sync(() => {
      const original = reminderEvent(0, { reminders: { useDefault: true } });

      const copy = {
        ...original,
        accountId: "other",
        calendarId: "shared",
        eventId: "copy",
      };

      const candidates = candidatesFor([copy, original]);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.calendar.calendarId).toBe("home");
      let state = scanReminders(startedReminders(), 0, { candidates });
      state = scanReminders(state, 15, { candidates });
      expect(state.context.deliveries).toHaveLength(0);
      state = scanReminders(state, 45, { candidates });
      expect(state.context.deliveries).toHaveLength(1);
      expect(state.context.deliveries[0]?.candidate.body).toContain("01:00");

      const emailOnly = candidatesFor([
        reminderEvent(1, {
          reminders: {
            overrides: [{ method: "email", minutes: 10 }],
            useDefault: false,
          },
        }),
      ]);

      expect(
        scanReminders(startedReminders(), 55, { candidates: emailOnly }).context
          .deliveries
      ).toHaveLength(0);
      expect(
        scanReminders(startedReminders(), 55, {
          candidates: candidatesFor([
            reminderEvent(2, {
              reminders: { overrides: [], useDefault: false },
            }),
          ]),
        }).context.deliveries
      ).toHaveLength(0);
    })
);

it.effect(
  "declined, hidden, focus, out-of-office, cancelled and free-busy records never emit",
  () =>
    Effect.sync(() => {
      const hidden = candidatesFor(
        [reminderEvent(0)],
        [calendarKey("person", "home")]
      );

      expect(
        scanReminders(startedReminders(), 55, { candidates: hidden }).context
          .deliveries
      ).toHaveLength(0);

      for (const fields of [
        {
          attendees: [
            {
              email: "fixture@example.test",
              responseStatus: "declined",
              self: true,
            },
          ],
        },
        { eventType: "focusTime" },
        { eventType: "outOfOffice" },
        { status: "cancelled" },
      ] as const) {
        expect(
          scanReminders(startedReminders(), 55, {
            candidates: candidatesFor([reminderEvent(0, fields)]),
          }).context.deliveries
        ).toHaveLength(0);
      }

      const freeBusy = candidatesFor([reminderEvent(0)]).map((candidate) => ({
        ...candidate,
        calendar: {
          ...candidate.calendar,
          accessRole: "freeBusyReader" as const,
        },
      }));

      expect(
        scanReminders(startedReminders(), 55, { candidates: freeBusy }).context
          .deliveries
      ).toHaveLength(0);
    })
);

it.effect(
  "new saved data catches crossed offsets once without replaying pre-baseline offsets",
  () =>
    Effect.sync(() => {
      let state = scanReminders(startedReminders(), 0, { candidates: [] });
      state = scanReminders(state, 55, { candidates: [] });
      state = scanReminders(state, 55, {
        accepted: Option.some({ origin: "snapshot", request: 2 }),
      });
      expect(state.context.deliveries).toHaveLength(1);
      state = scanReminders(state, 56, {
        accepted: Option.some({ origin: "snapshot", request: 3 }),
      });
      expect(state.context.deliveries).toHaveLength(0);

      const past = candidatesFor([
        reminderEvent(3, {
          reminders: {
            overrides: [{ method: "popup", minutes: 90 }],
            useDefault: false,
          },
        }),
      ]);

      expect(
        scanReminders(state, 57, {
          accepted: Option.some({ origin: "live", request: 4 }),
          candidates: past,
        }).context.deliveries
      ).toHaveLength(0);
    })
);

const Slot = Schema.Struct({
  declined: Schema.Boolean,
  defaults: Schema.Boolean,
  email: Schema.Boolean,
  eventType: Schema.Literals(["default", "focusTime", "outOfOffice"]),
  offset: Schema.Int.check(Schema.isBetween({ maximum: 60, minimum: 0 })),
  start: Schema.Int.check(Schema.isBetween({ maximum: 240, minimum: 1 })),
});

const Clock = Schema.Int.check(Schema.isBetween({ maximum: 300, minimum: 0 }));

const PopupId = Schema.fromJsonString(
  Schema.Tuple([Schema.Literal("popup"), Schema.String, Schema.Finite])
);

const generatedEvents = (
  slots: readonly (typeof Slot.Type)[],
  duplicate: boolean
) =>
  slots.flatMap((slot, index) => {
    const event = reminderEvent(index, {
      attendees: [
        {
          email: "fixture@example.test",
          responseStatus: slot.declined ? "declined" : "accepted",
          self: true,
        },
      ],
      eventType: slot.eventType,
      reminders: {
        overrides: [
          { method: slot.email ? "email" : "popup", minutes: slot.offset },
        ],
        useDefault: slot.defaults,
      },
      start: { dateTime: reminderInstant(slot.start) },
    });

    return duplicate
      ? [
          event,
          {
            ...event,
            accountId: "other",
            calendarId: "shared",
            eventId: `copy-${index}`,
          },
        ]
      : [event];
  });

const emittedKey = (notification: NotificationContentValue) => {
  const payload = Schema.decodeSync(PopupId)(notification.id);

  return JSON.stringify([notification.candidate.event.iCalUID, payload[2]]);
};

const expectedCrossings = (
  slots: readonly (typeof Slot.Type)[],
  from: number,
  until: number,
  defaultOffset: number | undefined
) =>
  slots.flatMap((slot, index) => {
    const offset = slot.defaults ? defaultOffset : slot.offset;

    if (
      defaultOffset === undefined ||
      offset === undefined ||
      slot.declined ||
      slot.eventType !== "default" ||
      (!slot.defaults && slot.email)
    ) {
      return [];
    }

    const due = slot.start - offset;

    return due > from && due <= until
      ? [JSON.stringify([`uid-${index}`, offset])]
      : [];
  });

it.effect.prop(
  "generated event sets and real actor clock walks emit every eligible crossing once",
  {
    clocks: Schema.Array(Clock),
    duplicate: Schema.Boolean,
    hideCopy: Schema.Boolean,
    hideMain: Schema.Boolean,
    slots: Schema.Array(Slot),
  },
  ({ slots, clocks, duplicate, hideMain, hideCopy }) =>
    Effect.gen(function* generatedReminderWalk() {
      const input = slots.slice(0, 8);

      const hidden = [
        ...(hideMain ? [calendarKey("person", "home")] : []),
        ...(hideCopy ? [calendarKey("other", "shared")] : []),
      ];

      const candidates: readonly ReminderCandidateValue[] = candidatesFor(
        generatedEvents(input, duplicate),
        hidden
      );

      const actor = yield* createEffectActor(reminderMachine);
      yield* watchActor("calendar.reminders.generated", actor);
      yield* advance(actor, { now: reminderEpoch, type: "START" });
      yield* advance(actor, {
        now: reminderEpoch,
        permission: "granted",
        type: "PERMISSION",
      });
      const expected = new Set<string>();
      const observed: string[] = [];
      let highWater = 0;
      const defaultOffset = hideMain ? undefined : 15;

      const selectedOffset =
        defaultOffset ?? (duplicate && !hideCopy ? 45 : undefined);

      for (const now of [0, 120, 20, 180, ...clocks.slice(0, 20)]) {
        for (const key of expectedCrossings(
          input,
          highWater,
          now,
          selectedOffset
        )) {
          expected.add(key);
        }

        highWater = Math.max(highWater, now);

        const snapshot = yield* advance(actor, {
          accepted: Option.some({ origin: "snapshot", request: 1 }),
          candidates,
          eventInvites: true,
          now: reminderEpoch + now * 60_000,
          personId: "fixture-person",
          scope: "generated-selection",
          snoozeRangeReady: undefined,
          type: "SCAN",
          webCards: false,
        });

        observed.push(...snapshot.context.deliveries.map(emittedKey));
        expect(observed.length).toBe(new Set(observed).size);
        expect([...observed].toSorted()).toEqual([...expected].toSorted());
        expect(Option.getOrUndefined(snapshot.context.lastChecked)).toBe(
          reminderEpoch + highWater * 60_000
        );
      }
    }).pipe(Effect.scoped)
);
