import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor } from "@xstate/effect";
import { Effect, Option, Queue, Schema, Stream } from "effect";
import { Mount } from "foldkit";

import { gridGeometry } from "../../layout/geometry.js";
import { MinuteRange } from "../../layout/time-blocks.js";
import { Message } from "../message.js";
import { bindGestureEvents } from "./gesture-events.js";
import { gestureMachine } from "./gesture-machine.js";
import type { GestureTargetRegistry } from "./gesture-targets.js";

type GestureMessage =
  | ReturnType<typeof Message.PreparedGestureHost>
  | ReturnType<typeof Message.PreviewedGesture>
  | ReturnType<typeof Message.CompletedGesture>
  | ReturnType<typeof Message.RefusedGesture>;

export const gestureMountFor = (registry?: GestureTargetRegistry) =>
  Mount.defineStream("PrepareGestures", {
    args: {
      hidden: Schema.optionalKey(Schema.Array(MinuteRange)),
      hostKey: Schema.String,
      personId: Schema.String,
      scale: Schema.Finite,
    },
    execute: ({
      element,
      hidden,
      hostKey,
      personId,
      scale,
      viewStateChanges,
    }) =>
      viewStateChanges.pipe(
        Stream.changes,
        Stream.switchMap((state) =>
          state === "Paused"
            ? Stream.empty
            : Stream.callback<GestureMessage>((queue) =>
                Effect.gen(function* prepareGestures() {
                  if (!(element instanceof HTMLElement)) {
                    return;
                  }

                  const actor = yield* createEffectActor(gestureMachine);
                  yield* watchActor("calendar.gesture", actor);
                  let completed = 0;
                  element.dataset.gesturePhase = "idle";
                  Queue.offerUnsafe(
                    queue,
                    Message.PreviewedGesture({
                      hostKey,
                      personId,
                      phase: "idle",
                      preview: Option.none(),
                    })
                  );
                  yield* Effect.acquireRelease(
                    Effect.sync(() =>
                      actor.subscribe((snapshot) => {
                        let phase: "idle" | "armed" | "dragging" = "idle";

                        if (snapshot.matches("armed")) {
                          phase = "armed";
                        }

                        if (snapshot.matches("dragging")) {
                          phase = "dragging";
                        }

                        element.dataset.gesturePhase = phase;
                        Queue.offerUnsafe(
                          queue,
                          Message.PreviewedGesture({
                            hostKey,
                            personId,
                            phase,
                            preview: Option.fromUndefinedOr(
                              snapshot.context.preview
                            ),
                          })
                        );
                        const result = snapshot.context.completed;

                        if (result !== undefined && result.id > completed) {
                          completed = result.id;
                          Queue.offerUnsafe(
                            queue,
                            Message.CompletedGesture({
                              gesture: result,
                              hostKey,
                              personId,
                            })
                          );
                        }
                      })
                    ),
                    (subscription) =>
                      Effect.sync(() => {
                        subscription.unsubscribe();
                      })
                  );
                  yield* Effect.acquireRelease(
                    Effect.sync(() =>
                      bindGestureEvents({
                        actor,
                        getTargets: () => registry?.read(hostKey, element),
                        grid: gridGeometry(scale, hidden),
                        refused: (reason) => {
                          Queue.offerUnsafe(
                            queue,
                            Message.RefusedGesture({
                              hostKey,
                              personId,
                              reason,
                            })
                          );
                        },
                        root: element,
                        scale,
                      })
                    ),
                    (release) => Effect.sync(release)
                  );
                  Queue.offerUnsafe(
                    queue,
                    Message.PreparedGestureHost({ hostKey })
                  );
                })
              )
        ),
        Stream.ensuring(
          Effect.sync(() => {
            if (element instanceof HTMLElement) {
              Reflect.deleteProperty(element.dataset, "gesturePhase");
            }

            registry?.releaseHost(hostKey, element);
          })
        )
      ),
    messages: [
      Message.RefusedGesture,
      Message.PreparedGestureHost,
      Message.PreviewedGesture,
      Message.CompletedGesture,
    ],
  });

export const PrepareGestures = gestureMountFor();
