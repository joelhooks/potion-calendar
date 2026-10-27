import { watchActor } from "@calendar/capability/actor-watch";
import {
  createEffectActor,
  createEffectLogic,
  setupEffect,
} from "@xstate/effect";
import { Deferred, Effect, Schema } from "effect";
import { types } from "xstate";

import { DesktopError } from "./config.js";

export const promptDismissalIntervalMs = 200;

interface WindowJob {
  readonly work: Effect.Effect<void>;
}

export const promptWindowLifecycle = () => {
  const perform = createEffectLogic({
    effect: ({ input }: { readonly input: WindowJob | undefined }) =>
      input === undefined
        ? Effect.die(new Error("Prompt window lifecycle invoked without work"))
        : input.work,
    schemas: { input: types<WindowJob | undefined>() },
  });

  return setupEffect({
    actors: { perform },
    schemas: {
      context: types<{ readonly job: WindowJob | undefined }>(),
      events: {
        Closed: Schema.Struct({}),
        Dismiss: types<{ readonly job: WindowJob }>(),
        Present: types<{ readonly job: WindowJob }>(),
        Quit: types<{ readonly job: WindowJob }>(),
      },
    },
  }).createMachine({
    context: { job: undefined },
    id: "promptWindowLifecycle",
    initial: "destroyed",
    on: {
      Closed: { target: ".destroyed" },
      Dismiss: ({ event }) => ({
        context: { job: event.job },
        reenter: true,
        target: ".dismissing",
      }),
      Present: ({ event }) => ({
        context: { job: event.job },
        reenter: true,
        target: ".presenting",
      }),
      Quit: ({ event }) => ({
        context: { job: event.job },
        target: ".quitting",
      }),
    },
    states: {
      destroyed: {},
      dismissing: {
        invoke: {
          input: ({ context }) => context.job,
          onDone: { target: "destroyed" },
          src: "perform",
        },
      },
      live: {},
      presenting: {
        invoke: {
          input: ({ context }) => context.job,
          onDone: { target: "live" },
          src: "perform",
        },
      },
      quit: { type: "final" },
      quitting: {
        invoke: {
          input: ({ context }) => context.job,
          onDone: { target: "quit" },
          src: "perform",
        },
        on: { Closed: {}, Dismiss: {}, Present: {}, Quit: {} },
      },
    },
  });
};

export const startPromptWindowLifecycle = Effect.fn(
  "Desktop.startPromptWindowLifecycle"
)(function* startPromptWindowLifecycle() {
  const actor = yield* createEffectActor(promptWindowLifecycle());
  yield* watchActor("desktop.promptWindowLifecycle", actor);

  const perform = Effect.fn("Desktop.performPromptWindowJob")(function* perform<
    A,
  >(
    type: "Dismiss" | "Present" | "Quit",
    work: Effect.Effect<A, DesktopError>
  ) {
    if (
      actor.getSnapshot().status === "done" ||
      actor.getSnapshot().matches("quitting")
    ) {
      return yield* new DesktopError({ message: "Meeting prompt has quit" });
    }

    const result = yield* Deferred.make<A, DesktopError>();

    actor.send({
      job: { work: Deferred.complete(result, work).pipe(Effect.asVoid) },
      type,
    });

    return yield* Deferred.await(result);
  });

  return { actor, perform };
});
