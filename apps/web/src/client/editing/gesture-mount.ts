import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor } from "@xstate/effect";
import { Effect, Option, Queue, Schema, Stream } from "effect";
import { Mount } from "foldkit";

import { Message } from "../message.js";
import { bindGestureEvents } from "./gesture-events.js";
import { gestureMachine } from "./gesture-machine.js";
import type { GestureTargetRegistry } from "./gesture-targets.js";

type GestureMessage =
  | ReturnType<typeof Message.PreparedGestureHost>
  | ReturnType<typeof Message.PreviewedGesture>
  | ReturnType<typeof Message.CompletedGesture>;

export const gestureMountFor = (registry?: GestureTargetRegistry) =>
  Mount.defineStream("PrepareGestures", {
    args: {
      hostKey: Schema.String,
      personId: Schema.String,
      scale: Schema.Finite,
    },
    execute: ({ element, hostKey, personId, scale }) =>
      Stream.callback<GestureMessage>((queue) =>
        Effect.gen(function* prepareGestures() {
          if (!(element instanceof HTMLElement)) {
            return;
          }

          yield* Effect.addFinalizer(() =>
            Effect.sync(() => registry?.releaseHost(hostKey, element))
          );
          const actor = yield* createEffectActor(gestureMachine);
          yield* watchActor("calendar.gesture", actor);
          let completed = 0;
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

                Queue.offerUnsafe(
                  queue,
                  Message.PreviewedGesture({
                    hostKey,
                    personId,
                    phase,
                    preview: Option.fromUndefinedOr(snapshot.context.preview),
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
                root: element,
                scale,
              })
            ),
            (release) => Effect.sync(release)
          );
          Queue.offerUnsafe(queue, Message.PreparedGestureHost({ hostKey }));
        })
      ),
    messages: [
      Message.PreparedGestureHost,
      Message.PreviewedGesture,
      Message.CompletedGesture,
    ],
  });

export const PrepareGestures = gestureMountFor();
