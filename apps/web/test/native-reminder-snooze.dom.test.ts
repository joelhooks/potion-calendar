import {
  NativeNotificationNotice,
  NativeNotificationRequest,
  nativeReminderSnoozeMinutes,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import {
  Arbitrary,
  Clock,
  Deferred,
  Effect,
  Fiber,
  Match,
  Option,
  Queue,
  Ref,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach, vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import {
  NotificationEvent,
  ReminderSnoozeStorage,
} from "../src/client/reminders/model.js";
import { nativeNotificationAgenda } from "../src/client/reminders/native-projection.js";
import { PublishNativeSnoozeOutcome } from "../src/client/reminders/native-snooze-commands.js";
import { liveSnoozeIdentities } from "../src/client/reminders/snooze-identities.js";
import {
  composedSnoozeRecipient,
  nativeSnoozeFixture,
  persistNativeSnooze,
  sampleNativeSnooze,
} from "./native-reminder-snooze-fixture.js";
import {
  nativeInvite,
  nativeReminderModel,
} from "./native-reminders-fixture.js";

it.effect(
  "composed native publication reaches a fixed point when a due snooze crosses event start",
  () =>
    Effect.gen(function* composedStartBoundary() {
      const h = yield* composedSnoozeRecipient();
      yield* h.schedule(h.start);
      const before = h.publications.length;
      yield* h.tick(h.start + 5000);
      const after = h.publications.length;
      yield* h.pump();
      expect(h.publications.length).toBe(after);
      expect(after - before).toBe(2);
      expect(
        h.executed.filter((name) => name === "RemoveReminderSnoozes")
      ).toHaveLength(1);
      expect(h.shown.filter((ref) => ref.id.includes("snooze"))).toEqual([]);
      expect(
        h.replies.some((call) =>
          call.reply.claims.some(
            (claim) => claim.key.eventId === nativeInvite.eventId
          )
        )
      ).toBe(true);
      expect((yield* Ref.get(h.state)).reminders.context.snoozes).toEqual([]);
      expect(
        h.pending.filter(
          (command) => command.name === "DeliverReminderNotification"
        )
      ).toEqual([]);
      expect(
        h.replies.filter(
          (call) =>
            call.reply.status === "stale" || call.reply.status === "superseded"
        )
      ).toEqual([]);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "web wire publishes a current Show revision for an unclaimed due snooze after event end",
  () =>
    Effect.gen(function* endedWirePublication() {
      const h = yield* composedSnoozeRecipient();
      yield* h.schedule(h.end + 10_000);
      yield* h.tick(h.end + 10_000);
      expect(h.shown.filter((ref) => ref.id.includes("snooze"))).toHaveLength(
        1
      );
      expect(
        h.replies.filter(
          (call) =>
            call.reply.status === "stale" || call.reply.status === "superseded"
        )
      ).toEqual([]);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect.each(["reminder", "invite"] as const)(
  "ordinary %s native receipt and retirement revisions preserve the base sequence",
  (kind) =>
    Effect.sync(() => {
      const fixture = nativeReminderModel(nativeInvite, kind);
      const ref = { ...fixture.ref, id: "base-control", kind };

      let model: AppModel = {
        ...fixture.model,
        reminders: {
          ...fixture.model.reminders,
          context: {
            ...fixture.model.reminders.context,
            active: fixture.model.reminders.context.active.map((entry) => ({
              ...entry,
              id: ref.id,
              nativeKind: kind,
            })),
          },
        },
      };

      const initial = model.desktop.notificationRevision ?? 0;
      const revisions = [initial];

      const apply = (message: Parameters<typeof update>[1]) => {
        ({ model } = update(model, message));
        revisions.push(model.desktop.notificationRevision ?? 0);
      };

      const observed = (notice: typeof NativeNotificationNotice.Type) =>
        Message.ObservedNotification({
          event: NotificationEvent.cases.Native.make({ notice }),
          now: model.calendar.now,
        });

      apply(observed(NativeNotificationNotice.cases.Shown.make({ ref })));
      apply(observed(NativeNotificationNotice.cases.Shown.make({ ref })));
      apply(
        Message.ReminderDeliveryCompleted({
          failure: Option.none(),
          id: ref.id,
          personId: ref.personId,
        })
      );
      apply(
        Message.ReceivedUpcoming({
          personId: ref.personId,
          request: model.upcoming.request,
          result: {
            events: [{ ...nativeInvite, title: "Changed saved title" }],
            versions: [],
          },
        })
      );
      apply(observed(NativeNotificationNotice.cases.Clicked.make({ ref })));
      expect(revisions.map((revision) => revision - initial)).toEqual([
        0, 0, 0, 0, 1, 2,
      ]);
    })
);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it.effect.each(nativeReminderSnoozeMinutes)(
  "native %s minute snooze uses the existing writer and planner without a browser card or premature close",
  (choice) =>
    Effect.gen(function* nativeDuration() {
      const h = yield* nativeSnoozeFixture();
      const original = yield* Ref.get(h.state);
      const [active] = original.reminders.context.active;

      if (active === undefined) {
        return yield* Effect.die("Missing native reminder");
      }

      yield* TestClock.adjust(59_000);
      const now = yield* Clock.currentTimeMillis;
      yield* h.choose(choice);
      const requested = yield* h.take;
      expect(
        requested.commands?.filter(
          (command) => command.name === "SampleReminderSnoozeClock"
        )
      ).toHaveLength(1);
      const sampled = yield* sampleNativeSnooze(requested);
      const saving = yield* h.apply(sampled);
      expect(saving.model.reminders.context.active).toHaveLength(1);
      expect(saving.model.reminders.context.snoozes).toEqual([]);
      expect(h.requests.filter(NativeNotificationRequest.guards.Close)).toEqual(
        []
      );
      const saved = yield* persistNativeSnooze(saving);
      expect(Option.isSome(saved)).toBe(true);

      if (Option.isNone(saved)) {
        return yield* Effect.die("Native snooze did not reach the real writer");
      }

      const committed = yield* h.apply(saved.value);

      const entry = {
        due: now + choice * 60_000,
        identity: active.candidate.identity,
      };

      expect(committed.model.reminders.context.snoozes).toEqual([entry]);
      expect(committed.model.reminders.context.active).toEqual([]);
      expect(
        JSON.parse(
          localStorage.getItem(
            `calendar.reminder-snoozes.v1.${active.personId}`
          ) ?? "null"
        )
      ).toEqual([entry]);
      expect(committed.commands?.map((command) => command.name)).toContain(
        "CloseReminderNotifications"
      );
      yield* h.apply(Message.Ticked({ now: entry.due - 1 }));
      expect((yield* Ref.get(h.state)).reminders.context.active).toEqual([]);
      const fired = yield* h.apply(Message.Ticked({ now: entry.due }));
      expect(fired.model.reminders.context.active).toHaveLength(1);
      expect(fired.model.reminders.context.active[0]).toMatchObject({
        nativeKind: "reminder",
        nativeSnoozedUntil: entry.due,
      });
      expect(fired.model.reminders.context.active[0]?.card).toBeUndefined();
      expect(fired.model.reminders.context.snoozes).toEqual([]);
      expect(
        liveSnoozeIdentities(fired.model.reminders.context).has(entry.identity)
      ).toBe(true);
      expect(
        (yield* h.apply(Message.Ticked({ now: entry.due + 1 }))).model.reminders
          .context.active
      ).toHaveLength(1);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "a superseded native snooze generation must not write after clock sampling",
  () =>
    Effect.gen(function* supersededGeneration() {
      const h = yield* nativeSnoozeFixture();
      yield* h.choose(5);
      const requested = yield* h.take;
      const now = yield* Clock.currentTimeMillis;
      const clock = yield* Clock.Clock;
      const started = yield* Deferred.make<boolean>();
      const released = yield* Deferred.make<boolean>();

      const sampling = yield* sampleNativeSnooze(requested).pipe(
        Effect.provideService(Clock.Clock, {
          currentTimeMillis: Deferred.succeed(started, true).pipe(
            Effect.andThen(Deferred.await(released)),
            Effect.as(now)
          ),
          currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
          currentTimeNanos: clock.currentTimeNanos,
          currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
          monotonicTimeNanos: clock.monotonicTimeNanos,
          monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
          sleep: (duration) => clock.sleep(duration),
        }),
        Effect.forkScoped
      );

      yield* Deferred.await(started);
      yield* h.replace;
      yield* Deferred.succeed(released, true);
      const prepared = yield* h.apply(yield* Fiber.join(sampling));
      const writes = vi.spyOn(Storage.prototype, "setItem");
      const saved = yield* persistNativeSnooze(prepared);

      if (Option.isSome(saved)) {
        yield* h.apply(saved.value);
      }

      expect(writes).not.toHaveBeenCalled();
      expect((yield* Ref.get(h.state)).reminders.context.snoozes).toEqual([]);
      expect(
        prepared.commands?.filter(
          (command) => command.name === "PersistReminderSnooze"
        ) ?? []
      ).toEqual([]);
      expect(
        (yield* Ref.get(h.state)).reminders.context.active[0]?.nativeRef
          ?.generation
      ).toBe(h.connection.ref.generation);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect.each(["before", "at", "after"] as const)(
  "Until start samples the actual clock %s the start boundary and suppresses ordinary offsets",
  (boundary) =>
    Effect.gen(function* untilStart() {
      const h = yield* nativeSnoozeFixture("near-start");
      const { start } = h.connection.ref;
      yield* TestClock.setTime(start - 1);
      yield* h.choose("start");
      const requested = yield* h.take;
      yield* TestClock.setTime(
        Match.value(boundary).pipe(
          Match.when("before", () => start - 1),
          Match.when("at", () => start),
          Match.when("after", () => start + 1),
          Match.exhaustive
        )
      );
      const prepared = yield* h.apply(yield* sampleNativeSnooze(requested));
      const saved = yield* persistNativeSnooze(prepared);

      if (boundary !== "before") {
        expect(saved).toEqual(Option.none());
        expect(prepared.model.reminders.context.snoozes).toEqual([]);

        return yield* Effect.void;
      }

      if (Option.isNone(saved)) {
        return yield* Effect.die("Missing native Until start save");
      }

      yield* h.apply(saved.value);
      const first = yield* h.apply(Message.Ticked({ now: start }));
      expect(
        first.model.reminders.context.active.filter(
          (entry) => entry.nativeSnoozedUntil === start
        )
      ).toHaveLength(1);
      expect(
        (yield* h.apply(Message.Ticked({ now: start + 60_000 }))).model
          .reminders.context.active
      ).toHaveLength(1);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "native snoozes fire after event end while ordinary and invitation ended events stay excluded",
  () =>
    Effect.gen(function* endedSnooze() {
      const h = yield* nativeSnoozeFixture("near-end");
      const initial = yield* Ref.get(h.state);
      const [active] = initial.reminders.context.active;

      if (active === undefined) {
        return yield* Effect.die("Missing native snooze event");
      }

      yield* TestClock.setTime(active.candidate.end - 1);
      yield* h.choose(1440);
      const saving = yield* h.apply(yield* sampleNativeSnooze(yield* h.take));
      const saved = yield* persistNativeSnooze(saving);

      if (Option.isNone(saved)) {
        return yield* Effect.die("Missing after-end snooze save");
      }

      yield* h.apply(saved.value);
      const due = active.candidate.end - 1 + 1440 * 60_000;
      const fired = yield* h.apply(Message.Ticked({ now: due }));
      expect(fired.model.reminders.context.active).toHaveLength(1);
      expect(fired.model.reminders.context.active[0]?.nativeSnoozedUntil).toBe(
        due
      );
      const agenda = nativeNotificationAgenda(fired.model);
      expect(agenda?.deliveries).toMatchObject([
        { beforeStart: false, kind: "reminder", snoozedUntil: due },
      ]);
      expect(agenda?.events).toHaveLength(1);
      expect(agenda?.events[0]?.end).toBeLessThan(due);

      const withoutSnooze = {
        ...fired.model,
        reminders: {
          ...fired.model.reminders,
          context: {
            ...fired.model.reminders.context,
            active: fired.model.reminders.context.active.map((entry) => ({
              ...entry,
              nativeSnoozedUntil: undefined,
            })),
          },
        },
      };

      expect(nativeNotificationAgenda(withoutSnooze)?.events).toEqual([]);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect.each([
  "person",
  "lease",
  "generation",
  "retired",
  "future",
  "key",
  "start",
] as const)(
  "native snooze refuses %s callbacks without reaching the writer",
  (change) =>
    Effect.gen(function* obsoleteNotice() {
      const h = yield* nativeSnoozeFixture();
      const { ref } = h.connection;

      if (change === "retired") {
        yield* h.send(NativeNotificationNotice.cases.Closed.make({ ref }));
        yield* h.take;
      }

      yield* h.choose(5, {
        ...ref,
        generation:
          change === "generation" ? ref.generation - 1 : ref.generation,
        key:
          change === "key" ? { ...ref.key, eventId: "wrong-event" } : ref.key,
        lease: change === "lease" ? "old-lease" : ref.lease,
        personId: change === "person" ? "other-person" : ref.personId,
        revision: change === "future" ? ref.revision + 100 : ref.revision,
        start: change === "start" ? ref.start + 1 : ref.start,
      });
      const event = yield* Queue.poll(h.events);

      if (Option.isSome(event)) {
        const model = yield* Ref.get(h.state);

        const result = yield* h.apply(
          Message.ObservedNotification({
            event: event.value,
            now: model.calendar.now,
          })
        );

        expect(
          result.commands?.filter(
            (command) => command.name === "SampleReminderSnoozeClock"
          ) ?? []
        ).toEqual([]);
      }

      expect((yield* Ref.get(h.state)).reminders.context.snoozes).toEqual([]);
      expect(
        localStorage.getItem(`calendar.reminder-snoozes.v1.${ref.personId}`)
      ).toBe("[]");

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "a native callback replay during a pending operation cannot queue another snooze",
  {
    replay: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 12, minimum: 1 }))
    ),
  },
  ({ replay }) =>
    Effect.gen(function* pendingReplay() {
      const h = yield* nativeSnoozeFixture();
      yield* h.choose(1);
      const requested = yield* h.take;

      for (let index = 0; index < replay; index += 1) {
        yield* h.choose(5);
      }

      expect(yield* Queue.poll(h.events)).toEqual(Option.none());
      expect(
        ReminderSnoozeStorage.guards.Sampling(
          requested.model.reminders.context.snoozeStorage
        )
      ).toBe(true);
      const prepared = yield* h.apply(yield* sampleNativeSnooze(requested));
      expect(
        prepared.commands?.filter(
          (command) => command.name === "PersistReminderSnooze"
        )
      ).toHaveLength(1);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "failed native snooze persistence preserves the reminder and reports failure instead of acceptance",
  () =>
    Effect.gen(function* failedWrite() {
      const h = yield* nativeSnoozeFixture();
      yield* h.choose(5);
      const saving = yield* h.apply(yield* sampleNativeSnooze(yield* h.take));
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("Read-only cache");
      });
      const saved = yield* persistNativeSnooze(saving);

      if (Option.isNone(saved)) {
        return yield* Effect.die("Missing failed native write");
      }

      const failed = yield* h.apply(saved.value);
      expect(failed.model.reminders.context.active).toHaveLength(1);
      expect(failed.model.reminders.context.snoozes).toEqual([]);
      expect(failed.commands?.map((command) => command.name)).not.toContain(
        "CloseReminderNotifications"
      );

      const outcome = failed.commands?.find(
        (command) => command.name === "PublishNativeSnoozeOutcome"
      );

      expect(outcome?.args).toMatchObject({ outcome: "failed" });
      yield* PublishNativeSnoozeOutcome({
        outcome: "failed",
        ref: h.connection.ref,
      }).effect;
      expect(
        NativeNotificationRequest.guards.SnoozeResult(h.requests.at(-1))
      ).toBe(true);
      expect(h.requests.at(-1)).toMatchObject({
        outcome: "failed",
        ref: h.connection.ref,
      });

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "native snooze inherits session-only storage failure without a second persistence path",
  () =>
    Effect.gen(function* sessionOnly() {
      const h = yield* nativeSnoozeFixture();
      yield* Ref.update(h.state, (model) => ({
        ...model,
        reminders: {
          ...model.reminders,
          context: {
            ...model.reminders.context,
            snoozeStorage: ReminderSnoozeStorage.cases.Failed.make({}),
          },
        },
      }));
      const writes = vi.spyOn(Storage.prototype, "setItem");
      yield* h.choose(1);
      const prepared = yield* h.apply(yield* sampleNativeSnooze(yield* h.take));
      expect(prepared.model.reminders.context.snoozes).toHaveLength(1);
      expect(prepared.model.reminders.context.active).toEqual([]);
      expect(prepared.commands?.map((command) => command.name)).not.toContain(
        "PersistReminderSnooze"
      );
      expect(writes).not.toHaveBeenCalled();

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);
