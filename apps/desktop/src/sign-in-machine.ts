import { watchActor } from "@calendar/capability/actor-watch";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import { Effect, Option, Schema } from "effect";
import { types } from "xstate";

import type { DesktopError } from "./config.js";

interface SignInWork {
  readonly wait: Effect.Effect<Option.Option<string>, DesktopError>;
  readonly redeem: (token: string) => Effect.Effect<void, DesktopError>;
}

interface SignInContext {
  readonly token: string;
  readonly outcome: "signedIn" | "failed" | "timedOut";
}

export const signInMachine = (work: SignInWork) => {
  const wait = createEffectLogic({ effect: work.wait });

  const redeem = createEffectLogic({
    effect: ({ input }) => work.redeem(input),
    schemas: { input: Schema.String },
  });

  return setupEffect({
    actors: { redeem, wait },
    schemas: { context: types<SignInContext>() },
  }).createMachine({
    context: { outcome: "failed", token: "" },
    initial: "waitingForCallback",
    output: ({ context }) => context.outcome,
    states: {
      failed: { type: "final" },
      redeeming: {
        invoke: {
          input: ({ context }) => context.token,
          onDone: { context: { outcome: "signedIn" }, target: "signedIn" },
          onError: { target: "failed" },
          src: "redeem",
        },
      },
      signedIn: { type: "final" },
      timedOut: { type: "final" },
      waitingForCallback: {
        invoke: {
          onDone: ({ event }) =>
            Option.isSome(event.output)
              ? { context: { token: event.output.value }, target: "redeeming" }
              : { context: { outcome: "timedOut" }, target: "timedOut" },
          onError: { target: "failed" },
          src: "wait",
        },
      },
    },
  });
};

export const runSignIn = Effect.fn("Desktop.signIn")(function* runSignIn(
  work: SignInWork
) {
  const machine = signInMachine(work);
  const actor = yield* createEffectActor(machine);
  yield* watchActor("desktopSignIn", actor);

  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Declared actor errors become a failed state; machine defects remain defects.
  return yield* join(actor).pipe(Effect.orDie);
}, Effect.scoped);
