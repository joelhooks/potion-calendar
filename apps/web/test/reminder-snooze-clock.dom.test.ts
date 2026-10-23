import { expect, it } from "@effect/vitest";
import {
  Clock,
  Duration,
  Effect,
  Fiber,
  Option,
  Queue,
  Ref,
  Schema,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach, vi } from "vitest";

import { initialModel, Message, update } from "../src/client/app.js";
import { ReminderSnoozeStorage } from "../src/client/reminders/model.js";
import {
  nextReminderSnoozeWake,
  reminderSnoozeWakeDependencies,
  reminderSnoozeWakeStream,
} from "../src/client/reminders/snooze-clock.js";
import {
  PersistReminderSnooze,
  RestoreReminderSnoozes,
  SampleReminderSnoozeClock,
} from "../src/client/reminders/snooze-commands.js";
import { reminderCardScene } from "./reminder-card-fixture.js";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it.effect(
  "a one-minute snooze uses the click-time Effect Clock rather than a 59-second-old model clock",
  () =>
    Effect.gen(function* staleModelClock() {
      const base = reminderCardScene("reminder", "light", 1440).model;
      const [notification] = base.reminders.context.active;

      if (notification === undefined) {
        return yield* Effect.die(new Error("Missing reminder card"));
      }

      yield* TestClock.setTime(base.calendar.now);

      const restored = update(
        base,
        yield* RestoreReminderSnoozes({ personId: notification.personId })
          .effect
      ).model;

      yield* TestClock.adjust(59_000);
      const now = yield* Clock.currentTimeMillis;

      const requested = update(
        restored,
        Message.RequestedReminderSnooze({
          choice: 1,
          id: notification.id,
          personId: notification.personId,
        })
      );

      const sample = SampleReminderSnoozeClock({
        choice: 1,
        id: notification.id,
        identity: notification.candidate.identity,
        personId: notification.personId,
      });

      expect(
        requested.commands?.map((command) => ({
          args: command.args,
          name: command.name,
        }))
      ).toEqual([{ args: sample.args, name: sample.name }]);
      const prepared = update(requested.model, yield* sample.effect);

      const entry = {
        due: now + 60_000,
        identity: notification.candidate.identity,
      };

      const persist = PersistReminderSnooze({
        entry,
        id: notification.id,
        personId: notification.personId,
      });

      expect(
        prepared.commands
          ?.filter((command) => command.name === persist.name)
          .map((command) => command.args)
      ).toEqual([persist.args]);
      expect(prepared.model.calendar.now).toBe(now);
      const saved = update(prepared.model, yield* persist.effect).model;

      yield* TestClock.adjust(1000);

      const minute = update(
        saved,
        Message.Ticked({ now: yield* Clock.currentTimeMillis })
      ).model;

      expect(minute.reminders.context.active).toEqual([]);

      const emitted =
        yield* Queue.unbounded<ReturnType<typeof Message.Ticked>>();

      yield* reminderSnoozeWakeStream(Option.some(entry.due)).pipe(
        Stream.runForEach((message) => Queue.offer(emitted, message)),
        Effect.forkScoped
      );
      yield* TestClock.adjust(58_999);
      expect(yield* Queue.size(emitted)).toBe(0);
      yield* TestClock.adjust(1);
      const tick = yield* Queue.take(emitted);
      const fired = update(minute, tick);

      expect(tick.now).toBe(entry.due);
      expect(fired.model.reminders.context.active).toHaveLength(1);
      expect(fired.model.reminders.context.active[0]?.card?.snoozedUntil).toBe(
        entry.due
      );

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "a sampled receipt must match the pending person, identity, card and choice before changing the clock",
  () =>
    Effect.gen(function* staleClockReceipt() {
      const base = reminderCardScene("reminder", "light", 1440).model;
      const [notification] = base.reminders.context.active;

      if (notification === undefined) {
        return yield* Effect.die(new Error("Missing reminder card"));
      }

      yield* TestClock.setTime(base.calendar.now);

      const { model } = update(
        base,
        yield* RestoreReminderSnoozes({ personId: notification.personId })
          .effect
      );

      const request = Message.RequestedReminderSnooze({
        choice: 1,
        id: notification.id,
        personId: notification.personId,
      });

      const sampling = update(model, request);

      yield* TestClock.adjust(59_000);

      const sampled = yield* SampleReminderSnoozeClock({
        choice: 1,
        id: notification.id,
        identity: notification.candidate.identity,
        personId: notification.personId,
      }).effect;

      for (const changed of [
        Message.ReminderSnoozeClockSampled({ ...sampled, choice: 5 }),
        Message.ReminderSnoozeClockSampled({ ...sampled, id: "other-card" }),
        Message.ReminderSnoozeClockSampled({
          ...sampled,
          identity: "other-event",
        }),
        Message.ReminderSnoozeClockSampled({
          ...sampled,
          personId: "other-person",
        }),
      ]) {
        const ignored = update(sampling.model, changed);

        expect(ignored.model.reminders.context).toEqual(
          sampling.model.reminders.context
        );
        expect(ignored.model.calendar.now).toBe(model.calendar.now);
        expect(ignored.commands ?? []).toEqual([]);
      }

      expect(update(sampling.model, request).commands ?? []).toEqual([]);
      const signedOut = update(sampling.model, Message.ClickedSignOut()).model;
      const ignored = update(signedOut, sampled);

      expect(ignored.model.reminders.context.snoozeStorage).toEqual(
        ReminderSnoozeStorage.cases.Ready.make({})
      );
      expect(ignored.model.reminders.context.snoozes).toEqual(
        signedOut.reminders.context.snoozes
      );
      expect(ignored.model.calendar.now).toBe(signedOut.calendar.now);
      expect(
        ignored.commands?.filter(
          (command) => command.name === "PersistReminderSnooze"
        ) ?? []
      ).toEqual([]);

      return yield* Effect.void;
    })
);

it.effect(
  "Until start rejects a choice that was visible on the stale model but has passed at click time",
  () =>
    Effect.gen(function* untilStartPassed() {
      const base = reminderCardScene("reminder", "light", 1440).model;
      const [notification] = base.reminders.context.active;

      if (notification === undefined) {
        return yield* Effect.die(new Error("Missing reminder card"));
      }

      yield* TestClock.setTime(base.calendar.now);

      const { model } = update(
        base,
        yield* RestoreReminderSnoozes({ personId: notification.personId })
          .effect
      );

      const sampling = update(
        model,
        Message.RequestedReminderSnooze({
          choice: "start",
          id: notification.id,
          personId: notification.personId,
        })
      );

      yield* TestClock.setTime(notification.candidate.start + 1);

      const sampled = yield* SampleReminderSnoozeClock({
        choice: "start",
        id: notification.id,
        identity: notification.candidate.identity,
        personId: notification.personId,
      }).effect;

      const rejected = update(sampling.model, sampled);

      expect(model.calendar.now).toBeLessThan(notification.candidate.start);
      expect(
        rejected.commands?.filter(
          (command) => command.name === "PersistReminderSnooze"
        ) ?? []
      ).toEqual([]);
      expect(rejected.model.reminders.context.snoozes).toEqual([]);
      expect(rejected.model.reminders.failure).toEqual(
        Option.some("The event has already started. Choose a duration instead.")
      );

      return yield* Effect.void;
    })
);

it.effect(
  "a hidden tab whose wake is throttled past due delivers on the next Ticked exactly once",
  () =>
    Effect.gen(function* throttledWake() {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      const base = reminderCardScene("reminder", "light", 1440).model;
      const [notification] = base.reminders.context.active;

      if (notification === undefined) {
        return yield* Effect.die(new Error("Missing reminder card"));
      }

      const entry = {
        due: base.calendar.now + 60_000,
        identity: notification.candidate.identity,
      };

      const model = {
        ...base,
        reminders: {
          ...base.reminders,
          context: { ...base.reminders.context, active: [], snoozes: [entry] },
        },
      };

      yield* TestClock.setTime(base.calendar.now + 3_600_000);

      const tick = Option.getOrThrow(
        yield* reminderSnoozeWakeStream(Option.some(entry.due)).pipe(
          Stream.runHead
        )
      );

      const fired = update(model, tick);
      const repeated = update(fired.model, tick);

      expect(tick.now).toBeGreaterThan(entry.due);
      expect(fired.model.reminders.context.active).toHaveLength(1);
      expect(
        fired.commands?.filter(
          (command) => command.name === "DeliverReminderNotification"
        )
      ).toHaveLength(1);
      expect(
        repeated.commands?.filter(
          (command) => command.name === "DeliverReminderNotification"
        ) ?? []
      ).toEqual([]);
      expect(repeated.model.reminders.context.active).toHaveLength(1);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "a backward wall-clock jump rechecks the same deadline and does not replay old reminders",
  () =>
    Effect.gen(function* backwardsWallClock() {
      const base = reminderCardScene("reminder", "light", 1440).model;
      const [notification] = base.reminders.context.active;

      if (notification === undefined) {
        return yield* Effect.die(new Error("Missing reminder card"));
      }

      yield* TestClock.setTime(0);
      const underlying = yield* Clock.Clock;
      const wall = yield* Ref.make(base.calendar.now);
      const sleeps = yield* Queue.unbounded<number>();

      const emitted =
        yield* Queue.unbounded<ReturnType<typeof Message.Ticked>>();

      const clock: Clock.Clock = {
        currentTimeMillis: Ref.get(wall),
        currentTimeMillisUnsafe: () => Ref.getUnsafe(wall),
        currentTimeNanos: underlying.currentTimeNanos,
        currentTimeNanosUnsafe: () => underlying.currentTimeNanosUnsafe(),
        monotonicTimeNanos: underlying.monotonicTimeNanos,
        monotonicTimeNanosUnsafe: () => underlying.monotonicTimeNanosUnsafe(),
        sleep: (duration) =>
          Queue.offer(sleeps, Duration.toMillis(duration)).pipe(
            Effect.andThen(underlying.sleep(duration))
          ),
      };

      const entry = {
        due: base.calendar.now + 60_000,
        identity: notification.candidate.identity,
      };

      yield* reminderSnoozeWakeStream(Option.some(entry.due)).pipe(
        Stream.runForEach((message) => Queue.offer(emitted, message)),
        Effect.provideService(Clock.Clock, clock),
        Effect.forkScoped
      );
      expect(yield* Queue.take(sleeps)).toBe(60_000);
      yield* Ref.set(wall, base.calendar.now - 60_000);
      yield* TestClock.adjust(60_000);

      const nextSleep = yield* Effect.race(
        Queue.take(sleeps).pipe(Effect.asSome),
        Queue.take(emitted).pipe(Effect.as(Option.none<number>()))
      );

      expect(nextSleep).toEqual(Option.some(120_000));
      expect(yield* Queue.size(emitted)).toBe(0);
      yield* Ref.set(wall, entry.due);
      yield* TestClock.adjust(120_000);
      const tick = yield* Queue.take(emitted);

      const model = {
        ...base,
        reminders: {
          ...base.reminders,
          context: {
            ...base.reminders.context,
            active: [],
            lastChecked: Option.some(base.calendar.now + 300_000),
            snoozeStorage: ReminderSnoozeStorage.cases.Ready.make({}),
            snoozes: [entry],
          },
        },
      };

      const backwards = update(
        model,
        Message.Ticked({ now: base.calendar.now - 60_000 })
      );

      const fired = update(backwards.model, tick);

      const replay = update(
        fired.model,
        Message.Ticked({ now: base.calendar.now - 60_000 })
      );

      const forward = update(
        replay.model,
        Message.Ticked({ now: base.calendar.now + 360_000 })
      );

      expect(
        backwards.commands?.filter(
          (command) => command.name === "DeliverReminderNotification"
        ) ?? []
      ).toEqual([]);
      expect(
        fired.commands?.filter(
          (command) => command.name === "DeliverReminderNotification"
        )
      ).toHaveLength(1);
      expect(
        replay.commands?.filter(
          (command) => command.name === "DeliverReminderNotification"
        ) ?? []
      ).toEqual([]);
      expect(
        forward.commands?.filter(
          (command) => command.name === "DeliverReminderNotification"
        ) ?? []
      ).toEqual([]);
      expect(forward.model.reminders.context.active).toHaveLength(1);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "canceling and rearming the single wake suppresses the previous deadline",
  () =>
    Effect.gen(function* cancelAndRearm() {
      yield* TestClock.setTime(0);
      const underlying = yield* Clock.Clock;
      const sleeping = yield* Ref.make(0);

      const clock: Clock.Clock = {
        currentTimeMillis: underlying.currentTimeMillis,
        currentTimeMillisUnsafe: () => underlying.currentTimeMillisUnsafe(),
        currentTimeNanos: underlying.currentTimeNanos,
        currentTimeNanosUnsafe: () => underlying.currentTimeNanosUnsafe(),
        monotonicTimeNanos: underlying.monotonicTimeNanos,
        monotonicTimeNanosUnsafe: () => underlying.monotonicTimeNanosUnsafe(),
        sleep: (duration) =>
          Effect.acquireUseRelease(
            Ref.update(sleeping, (count) => count + 1),
            () => underlying.sleep(duration),
            () => Ref.update(sleeping, (count) => count - 1)
          ),
      };

      const emitted =
        yield* Queue.unbounded<ReturnType<typeof Message.Ticked>>();

      const first = yield* reminderSnoozeWakeStream(Option.some(60_000)).pipe(
        Stream.runForEach((message) => Queue.offer(emitted, message)),
        Effect.provideService(Clock.Clock, clock),
        Effect.forkScoped
      );

      yield* TestClock.adjust(30_000);
      expect(yield* Ref.get(sleeping)).toBe(1);
      yield* Fiber.interrupt(first);
      yield* TestClock.adjust(0);
      expect(yield* Ref.get(sleeping)).toBe(0);
      yield* reminderSnoozeWakeStream(Option.some(120_000)).pipe(
        Stream.runForEach((message) => Queue.offer(emitted, message)),
        Effect.provideService(Clock.Clock, clock),
        Effect.forkScoped
      );
      yield* TestClock.adjust(30_000);
      expect(yield* Ref.get(sleeping)).toBe(1);
      expect(yield* Queue.size(emitted)).toBe(0);
      yield* TestClock.adjust(60_000);
      expect((yield* Queue.take(emitted)).now).toBe(120_000);
      expect(yield* Ref.get(sleeping)).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "the one wake selects the earliest future deadline and ignores already-due entries awaiting coverage",
  {
    offsets: Schema.Array(
      Schema.Int.check(Schema.isBetween({ maximum: 2000, minimum: -1000 }))
    ).check(Schema.isMaxLength(15)),
  },
  ({ offsets }) =>
    Effect.sync(() => {
      const model = initialModel(5000, "UTC");

      const context = {
        ...model.reminders.context,
        snoozes: offsets.map((offset, index) => ({
          due: 5000 + offset,
          identity: `event-${index}`,
        })),
      };

      const [expected] = offsets
        .filter((offset) => offset > 0)
        .toSorted((left, right) => left - right);

      expect(nextReminderSnoozeWake(context, 5000)).toEqual(
        Option.map(Option.fromUndefinedOr(expected), (offset) => 5000 + offset)
      );
    })
);

it.effect(
  "wake dependencies cancel on sign-out and person change and track restored, replaced and resolved queues",
  () =>
    Effect.sync(() => {
      const base = initialModel(5000, "UTC");

      const model = {
        ...base,
        person: Option.some("first"),
        reminders: {
          ...base.reminders,
          context: {
            ...base.reminders.context,
            snoozes: [
              { due: 7000, identity: "later" },
              { due: 6000, identity: "first" },
            ],
          },
        },
      };

      expect(reminderSnoozeWakeDependencies(model)).toEqual({
        due: Option.some(6000),
        person: Option.some("first"),
      });

      const replaced = {
        ...model,
        reminders: {
          ...model.reminders,
          context: {
            ...model.reminders.context,
            snoozes: [{ due: 7000, identity: "later" }],
          },
        },
      };

      expect(reminderSnoozeWakeDependencies(replaced).due).toEqual(
        Option.some(7000)
      );
      expect(
        reminderSnoozeWakeDependencies({ ...replaced, action: "pending" }).due
      ).toEqual(Option.none());
      expect(
        reminderSnoozeWakeDependencies({ ...replaced, person: Option.none() })
          .due
      ).toEqual(Option.none());
      expect(
        reminderSnoozeWakeDependencies({
          ...replaced,
          person: Option.some("second"),
        }).person
      ).toEqual(Option.some("second"));
      expect(
        reminderSnoozeWakeDependencies({
          ...replaced,
          reminders: {
            ...replaced.reminders,
            context: { ...replaced.reminders.context, snoozes: [] },
          },
        }).due
      ).toEqual(Option.none());
    })
);
