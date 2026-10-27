import { watchActor } from "@calendar/capability/actor-watch";
import {
  createEffectActor,
  createEffectLogic,
  setupEffect,
  waitFor,
} from "@xstate/effect";
import { Deferred, Effect, Schema } from "effect";
import { types } from "xstate";

import { DesktopError } from "./config.js";

export const promptDismissalIntervalMs = 200;

interface WindowJob {
  readonly work: Effect.Effect<void>;
}

interface PreviewRequest {
  readonly job: WindowJob;
  readonly result: Deferred.Deferred<boolean, DesktopError>;
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
    actions: {
      rejectBusyPreview: ({ event }: { readonly event: PreviewRequest }) =>
        Deferred.succeed(event.result, false).pipe(Effect.asVoid),
    },
    actors: { perform },
    schemas: {
      context: types<{ readonly job: WindowJob | undefined }>(),
      events: {
        Closed: Schema.Struct({}),
        Dismiss: types<{ readonly job: WindowJob }>(),
        Present: types<{ readonly job: WindowJob }>(),
        Preview: types<PreviewRequest>(),
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
      Preview: (args, enq) => {
        enq(args.actions.rejectBusyPreview, args);
      },
      Quit: ({ event }) => ({
        context: { job: event.job },
        target: ".quitting",
      }),
    },
    states: {
      destroyed: {
        on: {
          Preview: ({ event }) => ({
            context: { job: event.job },
            target: "previewing",
          }),
        },
      },
      dismissing: {
        invoke: {
          input: ({ context }) => context.job,
          onDone: { target: "destroyed" },
          src: "perform",
        },
      },
      live: {
        on: {
          Preview: ({ event }) => ({
            context: { job: event.job },
            target: "previewing",
          }),
        },
      },
      presenting: {
        invoke: {
          input: ({ context }) => context.job,
          onDone: { target: "live" },
          src: "perform",
        },
      },
      previewing: {
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
        on: {
          Closed: {},
          Dismiss: {},
          Present: {},
          Preview: (args, enq) => {
            enq(args.actions.rejectBusyPreview, args);
          },
          Quit: {},
        },
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

  const preview = Effect.fn("Desktop.performPromptPreview")(function* preview(
    work: Effect.Effect<boolean, DesktopError>
  ) {
    const result = yield* Deferred.make<boolean, DesktopError>();

    actor.send({
      job: {
        work: Deferred.complete(
          result,
          work.pipe(Effect.onInterrupt(() => Deferred.succeed(result, false)))
        ).pipe(Effect.asVoid),
      },
      result,
      type: "Preview",
    });

    return yield* Effect.raceFirst(
      Deferred.await(result),
      waitFor(actor, (snapshot) => snapshot.status !== "active").pipe(
        Effect.catchTag("ActorStoppedError", () => Effect.void),
        Effect.andThen(Deferred.succeed(result, false)),
        Effect.andThen(Deferred.await(result))
      )
    );
  });

  return { actor, perform, preview };
});
