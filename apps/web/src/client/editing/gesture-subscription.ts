import { Effect, Option, Queue, Schema, Stream } from "effect";
import { Render, Subscription } from "foldkit";

import { Model } from "../app.js";
import type { AppModel, AppMessage } from "../app.js";
import { Message } from "../message.js";
import { modelGestureInputs } from "./gesture-targets.js";
import type { GestureTargetRegistry } from "./gesture-targets.js";

export const gestureSubscriptions = (registry: GestureTargetRegistry) =>
  Subscription.make<AppModel, AppMessage>()((entry) => ({
    gestureTargets: entry(
      {
        key: Schema.Option(Schema.String),
        model: Model,
      },
      {
        dependenciesToStream: ({ key }, readDependencies) =>
          Option.match(key, {
            onNone: () => Stream.empty,
            onSome: (hostKey) =>
              Stream.callback<
                ReturnType<typeof Message.PreparedGestureTargets>
              >((queue) =>
                Effect.gen(function* gestureTargetReader() {
                  yield* Render.afterCommit;

                  const host =
                    document.querySelector<HTMLElement>("#gesture-host");

                  if (host?.dataset.gestureHostKey !== hostKey) {
                    return;
                  }

                  yield* Effect.acquireRelease(
                    Effect.sync(() =>
                      registry.register(hostKey, host, () => {
                        const current = readDependencies();

                        return Option.contains(current.key, hostKey)
                          ? modelGestureInputs(current.model).targets
                          : undefined;
                      })
                    ),
                    (release) => Effect.sync(release)
                  );
                  Queue.offerUnsafe(queue, Message.PreparedGestureTargets());
                })
              ),
          }),
        keepAliveEquivalence: (previous, next) =>
          Option.getOrUndefined(previous.key) ===
          Option.getOrUndefined(next.key),
        modelToDependencies: (model) => ({
          key: modelGestureInputs(model).key,
          model,
        }),
      }
    ),
  }));
