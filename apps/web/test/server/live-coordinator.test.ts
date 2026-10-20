import { Gone, NotFound, Provider, Revoked } from "@calendar/calendar";
import type { CalendarFailureValue } from "@calendar/calendar";
import { expect, it } from "@effect/vitest";
import { Clock, Deferred, Effect, Fiber, Match, Ref, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { TestClock } from "effect/testing";

import { makeLiveCoordinator } from "../../src/server/live-coordinator.js";
import type {
  LiveJobValue,
  LiveOutputValue,
  LiveWorkValue,
} from "../../src/server/live-work.js";
import {
  LiveWork,
  LiveOutput,
  liveWorkKey,
} from "../../src/server/live-work.js";

const work = LiveWork.cases.Calendar.make({
  accountId: "account",
  calendarId: "calendar",
});

const key = liveWorkKey(work);

const output = (version: number): LiveOutputValue =>
  LiveOutput.cases.Calendar.make({
    result: { changed: 1, cursor: `cursor-${version}`, version },
  });

const fakeJobs = Effect.gen(function* fakeJobs() {
  const state = yield* Ref.make<{
    readonly generation: number;
    readonly jobs: ReadonlyMap<string, LiveJobValue>;
    readonly results: ReadonlyMap<string, LiveOutputValue>;
  }>({ generation: 0, jobs: new Map(), results: new Map() });

  const enqueue = (input: LiveWorkValue) =>
    Ref.update(state, (current) => ({
      ...current,
      generation: current.generation + 1,
      jobs: new Map(current.jobs).set(liveWorkKey(input), {
        attempts: 0,
        dueAt: 0,
        generation: String(current.generation + 1),
        key: liveWorkKey(input),
        work: input,
      }),
    }));

  const get = (jobKey: string) =>
    Ref.get(state).pipe(Effect.map((current) => current.jobs.get(jobKey)));

  const last = (jobKey: string) =>
    Ref.get(state).pipe(Effect.map((current) => current.results.get(jobKey)));

  const complete = (job: LiveJobValue, value: LiveOutputValue) =>
    Ref.modify(state, (current) => {
      const newest = current.jobs.get(job.key);

      const accepted =
        newest === undefined || newest.generation === job.generation;

      const jobs = new Map(current.jobs);

      if (accepted) {
        jobs.delete(job.key);
      }

      return [
        accepted,
        {
          ...current,
          jobs,
          results: new Map(current.results).set(job.key, value),
        },
      ];
    });

  const discard = (jobKey: string) =>
    Ref.update(state, (current) => {
      const jobs = new Map(current.jobs);
      jobs.delete(jobKey);

      return { ...current, jobs };
    });

  const retry = (job: LiveJobValue, now: number, delayMs: number) =>
    Ref.update(state, (current) => ({
      ...current,
      jobs: new Map(current.jobs).set(job.key, {
        ...job,
        attempts: job.attempts + 1,
        dueAt: now + delayMs,
      }),
    }));

  return { complete, discard, enqueue, get, last, retry };
});

it.effect(
  "a disconnect barrier waits for existing inventory without blocking a different calendar key",
  () =>
    Effect.gen(function* inventoryBarrier() {
      const jobs = yield* fakeJobs;
      const inventory = LiveWork.cases.Inventory.make({});
      const inventoryKey = liveWorkKey(inventory);
      yield* jobs.enqueue(inventory);
      yield* jobs.enqueue(work);
      const entered = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();
      const waiterEntered = yield* Deferred.make<boolean>();
      const waited = yield* Ref.make(false);

      const coordinator = yield* makeLiveCoordinator(jobs, (current) =>
        LiveWork.guards.Inventory(current)
          ? Deferred.succeed(entered, true).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as(LiveOutput.cases.Inventory.make({}))
            )
          : Effect.succeed(output(1))
      );

      const owner = yield* coordinator
        .run(inventoryKey)
        .pipe(Effect.forkScoped);

      yield* Deferred.await(entered);

      const waiter = yield* Deferred.succeed(waiterEntered, true).pipe(
        Effect.andThen(coordinator.awaitExisting(inventoryKey)),
        Effect.andThen(Ref.set(waited, true)),
        Effect.forkScoped
      );

      yield* Deferred.await(waiterEntered);
      expect(yield* coordinator.run(key)).toEqual(output(1));
      expect(yield* Ref.get(waited)).toBe(false);
      yield* Deferred.succeed(release, true);
      yield* Fiber.join(owner);
      yield* Fiber.join(waiter);
      expect(yield* Ref.get(waited)).toBe(true);
      yield* coordinator.awaitExisting("not-running");
      expect(yield* jobs.get("not-running")).toBeUndefined();
    })
);

it.effect(
  "one person coordinator permits six different calendar keys to sync together",
  () =>
    Effect.gen(function* parallelCalendarKeys() {
      const jobs = yield* fakeJobs;

      const calendars = Array.from({ length: 6 }, (_, index) =>
        LiveWork.cases.Calendar.make({
          accountId: "account",
          calendarId: `calendar-${index}`,
        })
      );

      yield* Effect.forEach(calendars, (calendar) => jobs.enqueue(calendar), {
        discard: true,
      });

      const entered = yield* Deferred.make<boolean>();

      const state = yield* Ref.make({ active: 0, completed: 0, peak: 0 });

      const coordinator = yield* makeLiveCoordinator(jobs, () =>
        Effect.acquireUseRelease(
          Ref.update(state, (previous) => ({
            ...previous,
            active: previous.active + 1,
            peak: Math.max(previous.peak, previous.active + 1),
          })).pipe(Effect.andThen(Deferred.succeed(entered, true))),
          () =>
            Effect.sleep(100).pipe(
              Effect.andThen(
                Ref.update(state, (previous) => ({
                  ...previous,
                  completed: previous.completed + 1,
                }))
              ),
              Effect.as(output(1))
            ),
          () =>
            Ref.update(state, (previous) => ({
              ...previous,
              active: previous.active - 1,
            }))
        )
      );

      const fiber = yield* Effect.forEach(
        calendars,
        (calendar) => coordinator.run(liveWorkKey(calendar)),
        { concurrency: 6 }
      ).pipe(Effect.forkScoped);

      yield* Deferred.await(entered);
      yield* TestClock.adjust(100);

      expect(yield* Ref.get(state)).toEqual({
        active: 0,
        completed: 6,
        peak: 6,
      });
      expect(yield* Fiber.join(fiber)).toHaveLength(6);
    })
);

it.effect.prop(
  "bursts during a running sync share one flight and exactly one follow-up",
  {
    burst: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 30, minimum: 0 }))
    ),
    join: Arbitrary.schema(Schema.Boolean),
  },
  ({ burst, join }) =>
    Effect.gen(function* singleFlightHistory() {
      const jobs = yield* fakeJobs;
      const started = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();
      const counters = yield* Ref.make({ active: 0, calls: 0, maximum: 0 });

      const execute = Effect.fn("test.executeLiveWork")(
        function* execute() {
          const call = yield* Ref.modify(counters, (current) => {
            const active = current.active + 1;

            return [
              current.calls + 1,
              {
                active,
                calls: current.calls + 1,
                maximum: Math.max(current.maximum, active),
              },
            ];
          });

          if (call === 1) {
            yield* Deferred.succeed(started, true);
            yield* Deferred.await(release);
          }

          return output(call);
        },
        Effect.ensuring(
          Ref.update(counters, (current) => ({
            ...current,
            active: current.active - 1,
          }))
        )
      );

      const coordinator = yield* makeLiveCoordinator(jobs, execute);

      yield* jobs.enqueue(work);

      const owner = yield* coordinator.run(key).pipe(Effect.forkScoped);

      yield* Deferred.await(started);

      const joined: Fiber.Fiber<
        LiveOutputValue | undefined,
        CalendarFailureValue
      >[] = [];

      for (let index = 0; index < burst; index += 1) {
        yield* jobs.enqueue(work);

        if (join) {
          joined.push(yield* coordinator.run(key).pipe(Effect.forkScoped));
        }
      }

      yield* Effect.yieldNow;
      yield* Deferred.succeed(release, true);
      yield* Fiber.join(owner);

      for (const observer of joined) {
        yield* Fiber.join(observer);
      }

      expect(yield* Ref.get(counters)).toEqual({
        active: 0,
        calls: burst === 0 ? 1 : 2,
        maximum: 1,
      });
      expect(yield* jobs.get(key)).toBeUndefined();
      expect(yield* jobs.last(key)).toEqual(output(burst === 0 ? 1 : 2));
    })
);

it.effect(
  "transient failures keep durable work pending with an alarm retry deadline",
  () =>
    Effect.gen(function* retryPending() {
      const jobs = yield* fakeJobs;

      const coordinator = yield* makeLiveCoordinator(jobs, () =>
        Effect.fail(
          new Provider({ message: "down", operation: "sync", status: 503 })
        )
      );

      yield* jobs.enqueue(work);

      const failure = yield* coordinator.run(key).pipe(Effect.flip);
      const queued = yield* jobs.get(key);

      expect(failure._tag).toBe("Provider");
      expect(queued?.attempts).toBe(1);
      expect(queued?.dueAt).toBe((yield* Clock.currentTimeMillis) + 1000);
      expect(yield* jobs.last(key)).toBeUndefined();
    })
);

it.effect(
  "revoked accounts discard work rather than retrying unusable credentials",
  () =>
    Effect.gen(function* revokedPending() {
      const jobs = yield* fakeJobs;

      const coordinator = yield* makeLiveCoordinator(jobs, () =>
        Effect.fail(new Revoked({ accountId: work.accountId }))
      );

      yield* jobs.enqueue(work);

      expect((yield* coordinator.run(key).pipe(Effect.flip))._tag).toBe(
        "Revoked"
      );
      expect(yield* jobs.get(key)).toBeUndefined();
      expect(yield* jobs.last(key)).toBeUndefined();
    })
);

it.effect.prop(
  "inventory failures back off at 1, 5, 15 and 60 minutes, remain capped and do no work before the deadline",
  { errorKind: Schema.Literals(["Provider", "NotFound", "Gone"]) },
  ({ errorKind }) =>
    Effect.gen(function* inventoryBackoff() {
      const jobs = yield* fakeJobs;
      const inventory = LiveWork.cases.Inventory.make({});
      const inventoryKey = liveWorkKey(inventory);
      const attempts = yield* Ref.make(0);
      yield* jobs.enqueue(inventory);

      const failure = Match.value(errorKind).pipe(
        Match.when(
          "Provider",
          () =>
            new Provider({
              message: "unavailable",
              operation: "watch",
              status: 503,
            })
        ),
        Match.when("NotFound", () => new NotFound({ operation: "POST" })),
        Match.when("Gone", () => new Gone({ operation: "POST" })),
        Match.exhaustive
      );

      const coordinator = yield* makeLiveCoordinator(jobs, () =>
        Ref.update(attempts, (count) => count + 1).pipe(
          Effect.andThen(Effect.fail(failure))
        )
      );

      const delays = [60_000, 300_000, 900_000, 3_600_000, 3_600_000];

      for (const [index, delay] of delays.entries()) {
        const now = yield* Clock.currentTimeMillis;
        expect(
          (yield* coordinator.run(inventoryKey).pipe(Effect.flip))._tag
        ).toBe(errorKind);
        const pending = yield* jobs.get(inventoryKey);
        expect(pending?.dueAt).toBe(now + delay);
        expect(pending?.attempts).toBe(index + 1);
        expect(yield* Ref.get(attempts)).toBe(index + 1);
        yield* TestClock.adjust(delay - 1);
        yield* coordinator.run(inventoryKey);
        expect(yield* Ref.get(attempts)).toBe(index + 1);
        yield* TestClock.adjust(1);
      }
    })
);
