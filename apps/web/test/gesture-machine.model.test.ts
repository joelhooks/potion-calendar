import { watchActor } from "@calendar/capability/actor-watch";
import { expect, it } from "@effect/vitest";
import { createEffectActor, send } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import { Effect, Option, Queue, Schema } from "effect";

import { gestureMachine } from "../src/client/editing/gesture-machine.js";
import { GesturePoint } from "../src/client/editing/gesture-model.js";
import { dayFromIso } from "../src/layout/navigation.js";

const day = dayFromIso("2026-10-19");

const point = (at: number, large = false) =>
  GesturePoint.make({
    alt: false,
    at,
    day,
    minute: large ? 660 : 540,
    pointerId: 1,
    shift: false,
    x: large ? 10 : 0,
    y: large ? 10 : 0,
  });

type Actor = EffectActor<typeof gestureMachine>;

const step = Effect.fn("gestureStep")(function* gestureStep(
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

it.effect.prop(
  "generated pointer histories commit only a completed drag and clear previews on cancellation",
  {
    history: Schema.Array(
      Schema.Literals(["down", "small", "large", "up", "cancel"])
    ).check(Schema.isMaxLength(20)),
  },
  ({ history }) =>
    Effect.gen(function* generatedPointerHistory() {
      const actor = yield* createEffectActor(gestureMachine);
      yield* watchActor("calendar.gesture.test", actor);
      let phase = "idle";
      let completed = 0;

      for (const [index, command] of history.entries()) {
        const at = (index + 1) * 1000;

        if (command === "down") {
          yield* step(actor, {
            start: {
              allDay: false,
              edge: "body",
              point: point(at),
              target: Option.none(),
            },
            type: "DOWN",
          });

          if (phase === "idle") {
            phase = "armed";
          }
        } else if (command === "cancel") {
          yield* step(actor, { type: "CANCEL" });
          phase = "idle";
        } else if (command === "up") {
          yield* step(actor, { point: point(at, true), type: "UP" });

          if (phase === "dragging") {
            completed += 1;
          }

          phase = "idle";
        } else {
          yield* step(actor, {
            point: point(at, command === "large"),
            type: "MOVE",
          });

          if (phase === "armed" && command === "large") {
            phase = "dragging";
          }
        }

        const snapshot = actor.getSnapshot();
        expect(snapshot.value).toBe(phase);
        expect(snapshot.context.sequence).toBe(completed);
        expect(snapshot.context.preview !== undefined).toBe(
          phase === "dragging"
        );
      }
    })
);

it.effect(
  "a single empty click is not creation, a bounded double click creates thirty minutes, and its click is consumed",
  () =>
    Effect.gen(function* boundedDoubleClick() {
      const actor = yield* createEffectActor(gestureMachine);
      yield* watchActor("calendar.gesture.test", actor);

      for (const at of [100, 300]) {
        yield* step(actor, {
          start: {
            allDay: false,
            edge: "body",
            point: point(at),
            target: Option.none(),
          },
          type: "DOWN",
        });
        yield* step(actor, { point: point(at + 1), type: "UP" });
        expect(actor.getSnapshot().context.sequence).toBe(at === 100 ? 0 : 1);
      }

      expect(actor.getSnapshot().context.completed?.range).toMatchObject({
        endTime: "09:30",
        startTime: "09:00",
      });
      expect(actor.getSnapshot().context.blockClick).toBe(true);
      yield* step(actor, { type: "CLICK" });
      expect(actor.getSnapshot().context.blockClick).toBe(false);
    })
);
