import { CalendarReadFailure, Provider } from "@calendar/calendar";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Ref, Result, Schema } from "effect";
import { TestClock } from "effect/testing";

import { firstViewFixture } from "./first-view-fixture.js";

it.effect("six uncursored calendars finish first view in one sync delay", () =>
  Effect.gen(function* parallelFirstView() {
    const fixture = yield* firstViewFixture(6);

    const fiber = yield* fixture.timed.pipe(Effect.forkScoped);
    yield* Deferred.await(fixture.entered);
    yield* TestClock.adjust(100);

    const state = yield* Ref.get(fixture.state);
    expect(state.completed).toHaveLength(6);
    expect(state.peak).toBe(6);
    expect(state.active).toBe(0);
    expect(state.people).toEqual(fixture.refs.map(() => fixture.personId));
    expect(state.completedAtRange).toEqual(fixture.refs.map(() => 6));

    const { elapsed, result } = yield* Fiber.join(fiber);
    expect(elapsed).toBe(100);
    expect(result.events).toEqual([]);
    expect(result.versions).toEqual(
      fixture.refs.map((ref) => ({ ...ref, version: 1 }))
    );
  })
);

it.effect(
  "thirteen uncursored calendars use three bounded first-view sync waves",
  () =>
    Effect.gen(function* boundedFirstView() {
      const fixture = yield* firstViewFixture(13);

      const fiber = yield* fixture.timed.pipe(Effect.forkScoped);
      yield* Deferred.await(fixture.entered);
      yield* TestClock.adjust(300);

      const state = yield* Ref.get(fixture.state);
      expect(state.completed).toHaveLength(13);
      expect(state.peak).toBe(6);
      expect(state.active).toBe(0);
      expect(state.completedAtRange).toEqual(fixture.refs.map(() => 13));

      const { elapsed } = yield* Fiber.join(fiber);
      expect(elapsed).toBe(300);
    })
);

it.effect(
  "first view skips calendars that already have cursors and waits for the uncursored set",
  () =>
    Effect.gen(function* cachedFirstView() {
      const fixture = yield* firstViewFixture(6, [0, 2]);

      const fiber = yield* fixture.timed.pipe(Effect.forkScoped);
      yield* Deferred.await(fixture.entered);
      yield* TestClock.adjust(100);

      const state = yield* Ref.get(fixture.state);
      expect(state.started.toSorted()).toEqual([
        "calendar-1",
        "calendar-3",
        "calendar-4",
        "calendar-5",
      ]);
      expect(state.completedAtRange).toEqual(fixture.refs.map(() => 4));

      const { result } = yield* Fiber.join(fiber);
      expect(result.versions.map((ref) => ref.version)).toEqual([
        0, 1, 0, 1, 1, 1,
      ]);
    })
);

const failureStages: readonly ("read" | "sync")[] = ["read", "sync"];

for (const stage of failureStages) {
  it.effect(
    `first-view ${stage} failure preserves the calendar ref and returns no range result`,
    () =>
      Effect.gen(function* failedFirstView() {
        const fixture = yield* firstViewFixture(6, [], {
          calendarId: "calendar-2",
          stage,
        });

        const fiber = yield* fixture.program.pipe(
          Effect.result,
          Effect.forkScoped
        );

        if (stage === "sync") {
          yield* Deferred.await(fixture.entered);
          yield* TestClock.adjust(100);
        }

        const result = yield* Fiber.join(fiber);
        expect(Result.isFailure(result)).toBe(true);

        if (!Result.isFailure(result)) {
          return yield* Effect.die(
            new Error("Expected the first-view failure")
          );
        }

        expect(result.failure).toBeInstanceOf(CalendarReadFailure);

        if (!Schema.is(CalendarReadFailure)(result.failure)) {
          return yield* Effect.die(
            new Error("Expected the mapped calendar read failure")
          );
        }

        expect(result.failure.calendarId).toBe("calendar-2");
        expect(result.failure.accountId).toBe(fixture.refs[0]?.accountId);
        expect(Schema.is(Provider)(result.failure.cause)).toBe(true);

        const state = yield* Ref.get(fixture.state);
        expect(state.completedAtRange).toEqual([]);
        expect(state.active).toBe(0);

        return yield* Effect.void;
      })
  );
}
