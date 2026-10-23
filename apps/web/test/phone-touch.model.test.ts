import { watchActor } from "@calendar/capability/actor-watch";
import { expect, it } from "@effect/vitest";
import { createEffectActor, send } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import { Clock, Effect, Match, Option, Queue, Schema } from "effect";
import { TestClock } from "effect/testing";

import { gestureMachine } from "../src/client/editing/gesture-machine.js";
import {
  GesturePoint,
  GestureStart,
} from "../src/client/editing/gesture-model.js";
import { dayFromIso } from "../src/layout/navigation.js";

type Actor = EffectActor<typeof gestureMachine>;

const point = (x = 0, y = 0, pointerId = 1) =>
  GesturePoint.make({
    alt: false,
    at: 999_999,
    day: dayFromIso("2026-10-19"),
    minute: 540 + y,
    pointerId,
    shift: false,
    x,
    y,
  });

const start = () =>
  GestureStart.make({
    allDay: false,
    edge: "body",
    point: point(),
    target: Option.none(),
  });

const step = Effect.fn("phoneTouch.step")(function* step(
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

const harness = Effect.fn("phoneTouch.harness")(function* harness() {
  const clock = yield* Clock.Clock;
  const sleeps = yield* Queue.unbounded<{ completed: boolean }>();

  const recording = Clock.Clock.of({
    currentTimeMillis: clock.currentTimeMillis,
    currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
    currentTimeNanos: clock.currentTimeNanos,
    currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
    monotonicTimeNanos: clock.monotonicTimeNanos,
    monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
    sleep: (duration) =>
      Effect.gen(function* recordSleep() {
        const record = { completed: false };
        yield* Queue.offer(sleeps, record);
        yield* clock.sleep(duration);
        record.completed = true;
      }),
  });

  const actor = yield* createEffectActor(gestureMachine).pipe(
    Effect.provideService(Clock.Clock, recording)
  );

  yield* watchActor("calendar.phoneTouch.hold.test", actor);

  return { actor, sleeps };
});

const ready = (actor: Actor) =>
  Effect.callback<boolean>((resume) => {
    const check = () => {
      if (actor.getSnapshot().matches("ready")) {
        resume(Effect.succeed(true));
      }
    };

    const subscription = actor.subscribe(check);
    check();

    return Effect.sync(() => {
      subscription.unsubscribe();
    });
  });

it.effect.each([
  { cancelled: false, x: 7, y: 0 },
  { cancelled: true, x: 8, y: 0 },
  { cancelled: true, x: 9, y: 0 },
  { cancelled: true, x: 6, y: 6 },
  { cancelled: false, x: 5, y: 5 },
])(
  "hold uses the actor deadline and strict Euclidean slop: %j",
  ({ x, y, cancelled }) =>
    Effect.gen(function* strictHold() {
      const { actor, sleeps } = yield* harness();
      yield* step(actor, { start: start(), type: "PRESS" });
      const timer = yield* Queue.take(sleeps);
      yield* TestClock.adjust(449);
      expect(timer.completed).toBe(false);
      expect(actor.getSnapshot().value).toBe("pressed");
      expect(actor.getSnapshot().context.preview).toBeUndefined();
      expect(actor.getSnapshot().context.completed).toBeUndefined();
      yield* step(actor, { point: point(x, y), type: "MOVE" });
      yield* TestClock.adjust(1);
      expect(timer.completed).toBe(!cancelled);

      if (!cancelled) {
        yield* ready(actor);
      }

      expect(actor.getSnapshot().value).toBe(cancelled ? "idle" : "ready");
      expect(actor.getSnapshot().context.preview).toBeUndefined();
      yield* step(actor, { type: "ACTIVATE" });
      expect(actor.getSnapshot().value).toBe(cancelled ? "idle" : "dragging");
      yield* step(actor, { point: point(0, 30), type: "UP" });
      expect(actor.getSnapshot().context.sequence).toBe(cancelled ? 0 : 1);
    })
);

it.effect.prop(
  "generated timed touch histories never complete before an accepted hold and cancel without restarting",
  {
    history: Schema.Array(
      Schema.Struct({
        command: Schema.Literals([
          "press",
          "wait",
          "small",
          "boundary",
          "diagonal",
          "foreign",
          "activate",
          "up",
          "cancel",
        ]),
        millis: Schema.Int.check(
          Schema.isBetween({ maximum: 600, minimum: 0 })
        ),
      })
    ).check(Schema.isMaxLength(24)),
  },
  ({ history }) =>
    Effect.gen(function* timedHistories() {
      const { actor, sleeps } = yield* harness();
      let timer: { completed: boolean } | undefined;
      let phase = "idle";
      let now = 0;
      let deadline = 0;
      let completed = 0;

      for (const { command, millis } of history) {
        if (command === "wait") {
          now += millis;
          yield* TestClock.adjust(millis);

          if (phase === "pressed") {
            expect(timer?.completed).toBe(now >= deadline);

            if (now >= deadline) {
              yield* ready(actor);
              phase = "ready";
            }
          }
        } else if (command === "press") {
          yield* step(actor, { start: start(), type: "PRESS" });

          if (phase === "idle") {
            phase = "pressed";
            deadline = now + 450;
            timer = yield* Queue.take(sleeps);
          }
        } else if (command === "cancel") {
          yield* step(actor, { type: "CANCEL" });
          phase = "idle";
        } else if (command === "activate") {
          yield* step(actor, { type: "ACTIVATE" });

          if (phase === "ready") {
            phase = "dragging";
          }
        } else if (command === "up") {
          yield* step(actor, { point: point(0, 30), type: "UP" });

          if (phase === "dragging") {
            completed += 1;
          }

          phase = "idle";
        } else {
          const at = Match.value(command).pipe(
            Match.when("boundary", () => point(8, 0)),
            Match.when("diagonal", () => point(6, 6)),
            Match.when("foreign", () => point(40, 0, 2)),
            Match.orElse(() => point(7, 0))
          );

          yield* step(actor, { point: at, type: "MOVE" });

          if (
            phase === "pressed" &&
            (command === "boundary" || command === "diagonal")
          ) {
            phase = "idle";
          }
        }

        expect(actor.getSnapshot().value).toBe(phase);
        expect(actor.getSnapshot().context.sequence).toBe(completed);
        expect(actor.getSnapshot().context.preview !== undefined).toBe(
          phase === "dragging"
        );
      }
    })
);
