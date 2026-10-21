import { watchActor } from "@calendar/capability/actor-watch";
import { expect, it } from "@effect/vitest";
import { createEffectActor, send } from "@xstate/effect";
import { Effect, Queue, Schema } from "effect";

import { rectangleMachine } from "../src/client/selection/machine.js";

it.effect.prop(
  "rectangle actor histories keep Shift-click armed until actual movement and reject later movement after cancellation or completion",
  {
    commands: Schema.Array(
      Schema.Literals(["down", "near", "far", "up", "cancel", "reset"])
    ).check(Schema.isMaxLength(40)),
  },
  ({ commands }) =>
    Effect.gen(function* rectangleHistory() {
      const actor = yield* createEffectActor(rectangleMachine);
      yield* watchActor("calendar.selection.rectangle.test", actor);

      const observed =
        yield* Queue.unbounded<ReturnType<typeof actor.getSnapshot>>();

      yield* Effect.acquireRelease(
        Effect.sync(() =>
          actor.subscribe((snapshot) => {
            Queue.offerUnsafe(observed, snapshot);
          })
        ),
        (subscription) =>
          Effect.sync(() => {
            subscription.unsubscribe();
          })
      );
      let expected: "idle" | "armed" | "dragging" | "completed" = "idle";

      for (const command of commands) {
        switch (command) {
          case "down": {
            yield* send(actor, {
              point: { x: 20, y: 20 },
              pointerId: 7,
              type: "DOWN",
            });

            if (expected === "idle") {
              expected = "armed";
            }

            break;
          }

          case "near": {
            yield* send(actor, {
              point: { x: 23, y: 25 },
              pointerId: 7,
              type: "MOVE",
            });
            break;
          }

          case "far": {
            yield* send(actor, {
              point: { x: 40, y: 40 },
              pointerId: 7,
              type: "MOVE",
            });

            if (expected === "armed") {
              expected = "dragging";
            }

            break;
          }

          case "up": {
            yield* send(actor, {
              point: { x: 40, y: 40 },
              pointerId: 7,
              type: "UP",
            });

            if (expected === "armed") {
              expected = "idle";
            } else if (expected === "dragging") {
              expected = "completed";
            }

            break;
          }

          case "cancel": {
            yield* send(actor, { type: "CANCEL" });
            expected = "idle";
            break;
          }

          case "reset": {
            yield* send(actor, { type: "RESET" });
            expected = "idle";
            break;
          }

          default: {
            throw new Error("Unexpected rectangle history action.");
          }
        }

        const snapshot = yield* Queue.take(observed);
        expect(snapshot.value).toBe(expected);

        if (expected === "armed" || expected === "dragging") {
          expect(actor.getSnapshot().context.pointerId).toBe(7);
          expect(actor.getSnapshot().context.origin).toEqual({ x: 20, y: 20 });
        }
      }
    }).pipe(Effect.scoped)
);
