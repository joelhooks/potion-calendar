import type { Cause } from "effect";
import { Clock, Effect, Option, Queue, Stream } from "effect";
import { initialTransition, transition } from "xstate";

import { Message } from "../message.js";
import { visibilityResumeMachine } from "./machine.js";

const visibilityObserver = (
  clock: Clock.Clock,
  queue: Queue.Queue<
    ReturnType<typeof Message.ResumedFromBackground>,
    Cause.Done
  >
) => {
  let [snapshot] = initialTransition(visibilityResumeMachine);

  return () => {
    [snapshot] = transition(visibilityResumeMachine, snapshot, {
      now: clock.currentTimeMillisUnsafe(),
      type: document.visibilityState === "hidden" ? "HIDDEN" : "VISIBLE",
    });

    if (Option.isSome(snapshot.context.resumeAt)) {
      Queue.offerUnsafe(
        queue,
        Message.ResumedFromBackground({ now: snapshot.context.resumeAt.value })
      );
    }
  };
};

export const visibilityResumeStream = () =>
  Stream.callback<ReturnType<typeof Message.ResumedFromBackground>>((queue) =>
    Effect.gen(function* observeVisibility() {
      const clock = yield* Clock.Clock;

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const observe = visibilityObserver(clock, queue);
          observe();
          document.addEventListener("visibilitychange", observe);

          return observe;
        }),
        (observe) =>
          Effect.sync(() => {
            document.removeEventListener("visibilitychange", observe);
          })
      );
    })
  );
