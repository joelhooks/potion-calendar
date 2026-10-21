import { watchActor } from "@calendar/capability/actor-watch";
import { expect, it } from "@effect/vitest";
import { createEffectActor } from "@xstate/effect";
import { Effect, Option, Queue, Schema } from "effect";

import { monthScrollMachine } from "../src/client/month/scroll-machine.js";

const harness = Effect.fn("monthScrollHarness")(function* harness() {
  const actor = yield* createEffectActor(monthScrollMachine, {
    input: {
      covered: Option.none(),
      hostKey: "person-zone-month",
      rowHeight: 100,
      visibleWeek: 20_000,
    },
  });

  yield* watchActor("calendar.month.scroll.model.test", actor);

  const send = Effect.fn("monthScrollStep")(function* send(
    event: Parameters<typeof actor.send>[0]
  ) {
    const snapshots =
      yield* Queue.unbounded<ReturnType<typeof actor.getSnapshot>>();

    return yield* Effect.acquireUseRelease(
      Effect.sync(() =>
        actor.subscribe((snapshot) => {
          Queue.offerUnsafe(snapshots, snapshot);
        })
      ),
      () =>
        Effect.sync(() => {
          actor.send(event);
        }).pipe(Effect.andThen(Queue.take(snapshots))),
      (subscription) =>
        Effect.sync(() => {
          subscription.unsubscribe();
        })
    );
  });

  return { actor, send };
});

it.effect.prop(
  "a burst of scroll ticks publishes no coverage intent until settled and cannot repeat an in-flight or accepted range",
  {
    offsets: Schema.Array(
      Schema.Int.check(Schema.isBetween({ maximum: 200, minimum: -200 }))
    ),
  },
  ({ offsets }) =>
    Effect.gen(function* coalescedScroll() {
      const h = yield* harness();
      const { firstWeek } = h.actor.getSnapshot().context.position;

      for (const offset of offsets) {
        const snapshot = yield* h.send({
          firstWeek,
          focusedDay: Option.none(),
          scrollTop: 600 + offset,
          type: "SCROLL",
        });

        expect(Option.isNone(snapshot.context.request)).toBe(true);
      }

      const settled = yield* h.send({ type: "SETTLED" });
      const request = Option.getOrThrow(settled.context.request);
      expect(request.range.end - request.range.start).toBe(126);
      const repeated = yield* h.send({ type: "SETTLED" });
      expect(repeated.context.request).toEqual(Option.some(request));
      yield* h.send({ id: request.id, type: "COVERED" });
      const covered = yield* h.send({ type: "SETTLED" });
      expect(covered.context.request).toEqual(Option.some(request));
      expect(Option.isNone(covered.context.pendingRead)).toBe(true);
    })
);

it.effect.each([
  { offset: 299, rebasing: true, weekShift: -28 },
  { offset: 300, rebasing: false, weekShift: 0 },
  { offset: 900, rebasing: false, weekShift: 0 },
  { offset: 901, rebasing: true, weekShift: 21 },
])(
  "month scroll boundary at $offset preserves symmetric edge clearance",
  ({ offset, rebasing, weekShift }) =>
    Effect.gen(function* boundaryScroll() {
      const h = yield* harness();
      const { firstWeek } = h.actor.getSnapshot().context.position;

      const state = yield* h.send({
        firstWeek,
        focusedDay: Option.none(),
        scrollTop: offset,
        type: "SCROLL",
      });

      expect(state.matches("rebasing")).toBe(rebasing);
      expect(state.matches("tracking")).toBe(!rebasing);
      const pending = Option.getOrUndefined(state.context.pendingRebase);
      expect(pending?.position.firstWeek).toBe(
        rebasing ? firstWeek + weekShift : undefined
      );
    })
);

it.effect.prop(
  "scroll histories coalesce or withdraw an unrendered rebase before the matching frame commits",
  {
    offsets: Schema.Array(
      Schema.Int.check(Schema.isBetween({ maximum: 1200, minimum: 0 }))
    ),
  },
  ({ offsets }) =>
    Effect.gen(function* coalescedFrames() {
      for (const history of [[300], [900], offsets]) {
        const h = yield* harness();
        const { firstWeek } = h.actor.getSnapshot().context.position;

        for (const offset of history) {
          const state = yield* h.send({
            firstWeek,
            focusedDay: Option.none(),
            scrollTop: offset,
            type: "SCROLL",
          });

          expect(state.context.position.scrollTop).toBe(offset);
          const row = Math.floor(offset / 100);
          const pending = Option.getOrUndefined(state.context.pendingRebase);

          if (offset < 300 || offset > 900) {
            expect(pending?.position.firstWeek).toBe(firstWeek + (row - 6) * 7);
            expect(state.matches("rebasing")).toBe(true);
          } else {
            expect(pending).toBeUndefined();
            expect(state.matches("tracking")).toBe(true);
          }
        }
      }
    })
);

it.effect(
  "a large thumb jump replaces the pending frame and rejects the superseded acknowledgement",
  () =>
    Effect.gen(function* jumpedBeforeCommit() {
      const h = yield* harness();
      const { firstWeek } = h.actor.getSnapshot().context.position;

      const earlier = yield* h.send({
        firstWeek,
        focusedDay: Option.none(),
        scrollTop: 0,
        type: "SCROLL",
      });

      const old = Option.getOrThrow(earlier.context.pendingRebase);
      yield* h.send({ type: "SETTLED" });

      const latest = yield* h.send({
        firstWeek,
        focusedDay: Option.none(),
        scrollTop: 1200,
        type: "SCROLL",
      });

      const current = Option.getOrThrow(latest.context.pendingRebase);
      expect(latest.matches("rebasing")).toBe(true);
      expect(current.id).toBeGreaterThan(old.id);
      expect(current.position.firstWeek).toBe(firstWeek + 42);

      const stale = yield* h.send({
        firstWeek: old.position.firstWeek,
        id: old.id,
        scrollTop: 600,
        type: "APPLIED",
      });

      expect(stale.context.pendingRebase).toEqual(Option.some(current));

      const applied = yield* h.send({
        firstWeek: current.position.firstWeek,
        id: current.id,
        scrollTop: 600,
        type: "APPLIED",
      });

      expect(applied.context.position.firstWeek).toBe(
        current.position.firstWeek
      );
      expect(Option.isNone(applied.context.pendingRebase)).toBe(true);
      expect(Option.isNone(applied.context.request)).toBe(true);
    })
);

it.effect(
  "a rebase retains an offscreen focus in a bounded pin and requires the matching rendered frame acknowledgement",
  () =>
    Effect.gen(function* acknowledgedRebase() {
      const h = yield* harness();
      const { firstWeek } = h.actor.getSnapshot().context.position;

      const tracked = yield* h.send({
        firstWeek,
        focusedDay: Option.some(firstWeek + 125),
        scrollTop: 0,
        type: "SCROLL",
      });

      const plan = Option.getOrThrow(tracked.context.pendingRebase);
      expect(tracked.matches("rebasing")).toBe(true);
      expect(plan.pinnedWeek).toEqual(Option.some(firstWeek + 119));
      expect(Option.isNone(tracked.context.request)).toBe(true);

      const stale = yield* h.send({
        firstWeek: plan.position.firstWeek,
        id: plan.id + 1,
        scrollTop: 620,
        type: "APPLIED",
      });

      expect(stale.matches("rebasing")).toBe(true);
      yield* h.send({ type: "SETTLED" });

      const applied = yield* h.send({
        firstWeek: plan.position.firstWeek,
        id: plan.id,
        scrollTop: 620,
        type: "APPLIED",
      });

      expect(applied.matches("idle")).toBe(true);
      expect(applied.context.position.scrollTop).toBe(620);
      expect(Option.isNone(applied.context.pendingRebase)).toBe(true);
      expect(Option.getOrThrow(applied.context.request).range.start).toBe(
        plan.position.firstWeek
      );
    })
);

it.effect(
  "stale coverage acknowledgements cannot suppress a newer uncovered request or clear its pending state",
  () =>
    Effect.gen(function* staleCoverage() {
      const h = yield* harness();
      const first = yield* h.send({ type: "SETTLED" });
      const old = Option.getOrThrow(first.context.request);

      const tracked = yield* h.send({
        firstWeek: first.context.position.firstWeek,
        focusedDay: Option.none(),
        scrollTop: 1200,
        type: "SCROLL",
      });

      const plan = Option.getOrThrow(tracked.context.pendingRebase);
      yield* h.send({
        firstWeek: plan.position.firstWeek,
        id: plan.id,
        scrollTop: 600,
        type: "APPLIED",
      });
      const settled = yield* h.send({ type: "SETTLED" });
      const current = Option.getOrThrow(settled.context.pendingRead);
      expect(current.id).toBeGreaterThan(old.id);
      const stale = yield* h.send({ id: old.id, type: "COVERED" });
      expect(stale.context.pendingRead).toEqual(Option.some(current));
      expect(Option.isNone(stale.context.covered)).toBe(true);
      const failed = yield* h.send({ id: current.id, type: "FAILED" });
      expect(Option.isNone(failed.context.pendingRead)).toBe(true);
      const retry = yield* h.send({ type: "SETTLED" });
      expect(Option.getOrThrow(retry.context.request).id).toBeGreaterThan(
        current.id
      );
    })
);
