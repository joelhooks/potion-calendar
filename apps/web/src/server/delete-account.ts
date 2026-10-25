import { watchActor } from "@calendar/capability/actor-watch";
import type { AccountDeletionUnavailable } from "@calendar/core/contracts";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import { Context, Effect, Result, Schema } from "effect";
import { types } from "xstate";

const DeletionStep = Schema.Literals([
  "quiesce",
  "stop",
  "commit",
  "finalize",
  "resume",
]);

export interface AccountDeletionEffects {
  readonly run: (
    step: typeof DeletionStep.Type
  ) => Effect.Effect<void, AccountDeletionUnavailable>;
}

class AccountDeletionSteps extends Context.Service<
  AccountDeletionSteps,
  AccountDeletionEffects
>()("@calendar/web/AccountDeletionSteps") {}

const stepLogic = (step: typeof DeletionStep.Type) =>
  createEffectLogic({
    effect: () => {
      const work = AccountDeletionSteps.use((service) => service.run(step));

      const recoverable =
        step === "stop" || step === "finalize" || step === "resume";

      return (
        recoverable
          ? work.pipe(
              Effect.catchCause(() =>
                Effect.logWarning("Account deletion cleanup did not complete", {
                  step,
                })
              )
            )
          : work
      ).pipe(Effect.result);
    },
    schemas: { input: Schema.Void },
  });

interface DeletionContext {
  readonly failure: AccountDeletionUnavailable | undefined;
}

export const accountDeletionMachine = setupEffect({
  actors: {
    commit: stepLogic("commit"),
    finalize: stepLogic("finalize"),
    quiesce: stepLogic("quiesce"),
    resume: stepLogic("resume"),
    stop: stepLogic("stop"),
  },
  schemas: { context: types<DeletionContext>() },
}).createMachine({
  context: { failure: undefined },
  initial: "quiescing",
  output: ({
    context,
  }): Result.Result<"deleted", AccountDeletionUnavailable> =>
    context.failure === undefined
      ? Result.succeed("deleted")
      : Result.fail(context.failure),
  states: {
    committing: {
      invoke: {
        onDone: ({ event }) =>
          Result.isFailure(event.output)
            ? {
                context: { failure: event.output.failure },
                target: "resuming",
              }
            : { target: "finalizing" },
        src: "commit",
      },
    },
    deleted: { type: "final" },
    failed: { type: "final" },
    finalizing: {
      invoke: {
        onDone: { target: "deleted" },
        src: "finalize",
      },
    },
    quiescing: {
      invoke: {
        onDone: ({ event }) =>
          Result.isFailure(event.output)
            ? {
                context: { failure: event.output.failure },
                target: "failed",
              }
            : { target: "stopping" },
        src: "quiesce",
      },
    },
    resuming: {
      invoke: { onDone: { target: "failed" }, src: "resume" },
    },
    stopping: {
      invoke: { onDone: { target: "committing" }, src: "stop" },
    },
  },
});

export const deleteOwnedCalendarAccount = Effect.fn(
  "deleteOwnedCalendarAccount"
)(function* deleteOwnedCalendarAccount(effects: AccountDeletionEffects) {
  return yield* Effect.gen(function* executeAccountDeletion() {
    const actor = yield* createEffectActor(accountDeletionMachine);
    yield* watchActor("calendar.account.deletion", actor);
    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Actor crashes remain defects; declared deletion failures travel in Result.
    const result = yield* join(actor).pipe(Effect.orDie);

    if (Result.isFailure(result)) {
      return yield* result.failure;
    }

    return yield* Effect.void;
  }).pipe(Effect.provideService(AccountDeletionSteps, effects), Effect.scoped);
});
