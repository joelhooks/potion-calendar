import {
  AccountNotOwned,
  LastCalendarAccount,
  Provider,
} from "@calendar/calendar";
import {
  DisconnectAccountResult,
  disconnectAccountInstruction,
} from "@calendar/calendar/contracts";
import type { DisconnectAccountFailure } from "@calendar/calendar/contracts";
import { watchActor } from "@calendar/capability/actor-watch";
import {
  DisconnectReceipt,
  Reservation,
} from "@calendar/database/account-disconnect";
import type {
  AccountDisconnectRepository,
  DisconnectReceiptValue,
} from "@calendar/database/account-disconnect";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import { Context, Effect, Result, Schema } from "effect";
import { types } from "xstate";

const Steps = Schema.Literals(["begin", "stop", "remove", "notify"]);

const StepInput = Schema.Struct({
  accountId: Schema.String,
  receipt: Schema.optional(DisconnectReceipt),
});

type Failure = typeof DisconnectAccountFailure.Type;

class DisconnectSteps extends Context.Service<
  DisconnectSteps,
  {
    readonly run: (
      step: typeof Steps.Type,
      input: typeof StepInput.Type
    ) => Effect.Effect<DisconnectReceiptValue, Failure>;
  }
>()("@calendar/web/DisconnectSteps") {}

const stepLogic = (step: typeof Steps.Type) =>
  createEffectLogic({
    effect: ({ input }) =>
      DisconnectSteps.use((service) => service.run(step, input)).pipe(
        Effect.result
      ),
    schemas: { input: StepInput },
  });

interface DisconnectContext {
  readonly accountId: string;
  readonly receipt: DisconnectReceiptValue | undefined;
  readonly failure: Failure | undefined;
}

const settledStep = (result: Result.Result<DisconnectReceiptValue, Failure>) =>
  Result.isFailure(result)
    ? { context: { failure: result.failure }, target: "failed" }
    : { context: { receipt: result.success }, target: "resume" };

const disconnectMachine = setupEffect({
  actors: {
    begin: stepLogic("begin"),
    notify: stepLogic("notify"),
    remove: stepLogic("remove"),
    stop: stepLogic("stop"),
  },
  schemas: {
    context: types<DisconnectContext>(),
    input: Schema.Struct({ accountId: Schema.String }),
  },
}).createMachine({
  context: ({ input }) => ({
    ...input,
    failure: undefined,
    receipt: undefined,
  }),
  initial: "beginning",
  output: ({ context }): Result.Result<DisconnectReceiptValue, Failure> => {
    if (context.failure !== undefined) {
      return Result.fail(context.failure);
    }

    if (context.receipt === undefined) {
      throw new Error("Disconnect completed without a receipt");
    }

    return Result.succeed(context.receipt);
  },
  states: {
    beginning: {
      invoke: {
        input: ({ context }) => ({ accountId: context.accountId }),
        onDone: ({ event }) => settledStep(event.output),
        src: "begin",
      },
    },
    completed: { type: "final" },
    failed: { type: "final" },
    notifying: {
      invoke: {
        input: ({ context }) => ({
          accountId: context.accountId,
          receipt: context.receipt,
        }),
        onDone: ({ event }) => settledStep(event.output),
        src: "notify",
      },
    },
    removing: {
      invoke: {
        input: ({ context }) => ({
          accountId: context.accountId,
          receipt: context.receipt,
        }),
        onDone: ({ event }) => settledStep(event.output),
        src: "remove",
      },
    },
    resume: {
      always: ({ context }) => {
        const { receipt } = context;

        if (receipt === undefined) {
          throw new Error("Disconnect has no receipt");
        }

        switch (receipt.phase) {
          case "reserved": {
            return { target: "stopping" };
          }

          case "stopped": {
            return { target: "removing" };
          }

          case "removed": {
            return { target: "notifying" };
          }

          case "done": {
            return { target: "completed" };
          }

          default: {
            throw new Error("Disconnect has no durable phase");
          }
        }
      },
    },
    stopping: {
      invoke: {
        input: ({ context }) => ({
          accountId: context.accountId,
          receipt: context.receipt,
        }),
        onDone: ({ event }) => settledStep(event.output),
        src: "stop",
      },
    },
  },
});

const unavailable = () =>
  new Provider({
    message: "Account disconnection could not complete; retry the operation",
    operation: "account.disconnect",
    status: 0,
  });

export interface DisconnectEffects {
  readonly stop: (accountId: string) => Effect.Effect<void, Provider>;
  readonly notify: () => Effect.Effect<void, Provider>;
}

export const disconnectOwnedAccount = Effect.fn("disconnectOwnedAccount")(
  function* disconnectOwnedAccount(
    repository: AccountDisconnectRepository,
    effects: DisconnectEffects,
    accountId: string
  ) {
    const run = Effect.fn("disconnectStep.run")(function* run(
      step: typeof Steps.Type,
      input: typeof StepInput.Type
    ) {
      if (step === "begin") {
        const reserved = yield* repository
          .begin(input.accountId)
          .pipe(Effect.mapError(unavailable));

        if (Reservation.guards.NotOwned(reserved)) {
          return yield* new AccountNotOwned({ accountId: input.accountId });
        }

        if (Reservation.guards.LastAccount(reserved)) {
          return yield* new LastCalendarAccount({ accountId: input.accountId });
        }

        return reserved.receipt;
      }

      const { receipt } = input;

      if (receipt === undefined) {
        return yield* Effect.die(new Error("Disconnect step has no receipt"));
      }

      switch (step) {
        case "stop": {
          yield* effects.stop(receipt.accountId);

          return yield* repository
            .advance(receipt.accountId, "reserved", "stopped")
            .pipe(Effect.mapError(unavailable));
        }

        case "remove": {
          return yield* repository
            .remove(receipt.accountId)
            .pipe(Effect.mapError(unavailable));
        }

        case "notify": {
          yield* effects.notify();

          return yield* repository
            .advance(receipt.accountId, "removed", "done")
            .pipe(Effect.mapError(unavailable));
        }

        default: {
          return yield* Effect.die(
            new Error("Unknown account disconnect step")
          );
        }
      }
    });

    return yield* Effect.gen(function* runDisconnect() {
      const actor = yield* createEffectActor(disconnectMachine, {
        input: { accountId },
      });

      yield* watchActor("accountDisconnect", actor);
      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Declared failures are explicit outcomes; unexpected actor errors remain defects.
      const outcome = yield* join(actor).pipe(Effect.orDie);

      const receipt = yield* Result.match(outcome, {
        onFailure: Effect.fail,
        onSuccess: Effect.succeed,
      });

      if (receipt.phase !== "done") {
        return yield* unavailable();
      }

      return DisconnectAccountResult.make({
        accountId,
        disconnected: true,
        instruction: disconnectAccountInstruction,
        revocation: "notAttempted",
      });
    }).pipe(Effect.provideService(DisconnectSteps, { run }));
  },
  Effect.scoped
);
