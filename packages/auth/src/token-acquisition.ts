import { watchActor } from "@calendar/capability/actor-watch";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import type { Redacted } from "effect";
import { Effect, Result, Schema } from "effect";
import { types } from "xstate";

import { GoogleTokenAccount } from "./google-token-account.js";
import type { TokenAccount } from "./google-token-account.js";
import type { GoogleTokensError } from "./google-tokens-error.js";

interface TokenWork {
  readonly lookup: (
    accountId: string,
    forceRefresh: boolean
  ) => Effect.Effect<
    { readonly account: TokenAccount; readonly useCached: boolean },
    GoogleTokensError
  >;
  readonly cached: (
    account: TokenAccount
  ) => Effect.Effect<Redacted.Redacted, GoogleTokensError>;
  readonly refresh: (
    account: TokenAccount
  ) => Effect.Effect<Redacted.Redacted, GoogleTokensError>;
}

interface TokenContext {
  readonly account: TokenAccount | undefined;
  readonly accountId: string;
  readonly forceRefresh: boolean;
  readonly outcome:
    | Result.Result<Redacted.Redacted, GoogleTokensError>
    | undefined;
}

const Input = Schema.Struct({
  accountId: Schema.String,
  forceRefresh: Schema.Boolean,
});

export const tokenAcquisition = (work: TokenWork) => {
  const lookup = createEffectLogic({
    effect: ({ input }) => work.lookup(input.accountId, input.forceRefresh),
    schemas: { input: Input },
  });

  const cached = createEffectLogic({
    effect: ({ input }) => work.cached(input),
    schemas: { input: GoogleTokenAccount },
  });

  const refresh = createEffectLogic({
    effect: ({ input }) => work.refresh(input),
    schemas: { input: GoogleTokenAccount },
  });

  const machine = setupEffect({
    actors: { cached, lookup, refresh },
    schemas: { context: types<TokenContext>(), input: Input },
  }).createMachine({
    context: ({ input }) => ({
      ...input,
      account: undefined,
      outcome: undefined,
    }),
    initial: "checking",
    output: ({ context }) => context.outcome,
    states: {
      available: { type: "final" },
      cached: {
        invoke: {
          input: ({ context }) =>
            Schema.decodeUnknownSync(GoogleTokenAccount)(context.account),
          onDone: {
            context: ({ event }) => ({ outcome: Result.succeed(event.output) }),
            target: "available",
          },
          onError: {
            context: ({ event }) => ({ outcome: Result.fail(event.error) }),
            target: "unavailable",
          },
          src: "cached",
        },
      },
      checking: {
        invoke: {
          input: ({ context }) => ({
            accountId: context.accountId,
            forceRefresh: context.forceRefresh,
          }),
          onDone: ({ event }) => ({
            context: { account: event.output.account },
            target: event.output.useCached ? "cached" : "refreshing",
          }),
          onError: {
            context: ({ event }) => ({ outcome: Result.fail(event.error) }),
            target: "unavailable",
          },
          src: "lookup",
        },
      },
      refreshing: {
        invoke: {
          input: ({ context }) =>
            Schema.decodeUnknownSync(GoogleTokenAccount)(context.account),
          onDone: {
            context: ({ event }) => ({ outcome: Result.succeed(event.output) }),
            target: "available",
          },
          onError: {
            context: ({ event }) => ({ outcome: Result.fail(event.error) }),
            target: "unavailable",
          },
          src: "refresh",
        },
      },
      unavailable: { type: "final" },
    },
  });

  return Effect.fn("GoogleTokens.accessToken")(function* accessToken(
    accountId: string,
    options: { readonly forceRefresh?: boolean } = {}
  ) {
    const actor = yield* createEffectActor(machine, {
      input: { accountId, forceRefresh: options.forceRefresh === true },
    });

    yield* watchActor("googleTokenAcquisition", actor);
    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Declared actor failures travel in Result; machine defects remain defects.
    const outcome = yield* join(actor).pipe(Effect.orDie);

    if (outcome === undefined) {
      return yield* Effect.die(
        new Error("Token acquisition completed without an outcome")
      );
    }

    return yield* Result.match(outcome, {
      onFailure: Effect.fail,
      onSuccess: Effect.succeed,
    });
  }, Effect.scoped);
};
