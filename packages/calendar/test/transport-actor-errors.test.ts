import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Redacted } from "effect";

import { Provider } from "../src/errors.js";
import { GoogleTokens } from "../src/google-tokens.js";
import {
  GoogleHttp,
  GoogleRetryPolicy,
  googleRequest,
} from "../src/transport.js";

const requestActorCause = (execute: Effect.Effect<never, Provider>) =>
  Effect.gen(function* requestCause() {
    const fiber = yield* googleRequest({
      accountId: "fixture",
      method: "GET",
      path: "/fixture",
    }).pipe(
      Effect.provideService(GoogleTokens, {
        accessToken: () => Effect.succeed(Redacted.make("fixture-only-token")),
        accounts: () => Effect.succeed([]),
      }),
      Effect.provideService(GoogleHttp, { execute: () => execute }),
      Effect.provideService(GoogleRetryPolicy, { baseDelayMs: 0, retries: 0 }),
      Effect.forkScoped
    );

    const exit = yield* Fiber.await(fiber);

    if (Exit.isSuccess(exit)) {
      return yield* Effect.die(
        new Error("The failing request unexpectedly completed")
      );
    }

    return exit.cause;
  });

it.effect(
  "Google request completion preserves typed failure, defect, and self-interruption",
  () =>
    Effect.gen(function* transportActorKinds() {
      const typed = new Provider({
        message: "Fixture transport failure",
        operation: "fixture",
        status: 503,
      });

      const failure = yield* requestActorCause(Effect.fail(typed));
      expect(Cause.hasFails(failure)).toBe(true);
      expect(Cause.hasDies(failure)).toBe(false);
      expect(Cause.squash(failure)).toBeInstanceOf(Provider);
      const defect = new Error("Fixture transport defect");
      const failureDefect = yield* requestActorCause(Effect.die(defect));
      expect(Cause.hasDies(failureDefect)).toBe(true);
      expect(Cause.squash(failureDefect)).toBe(defect);
      const interrupted = yield* requestActorCause(Effect.interrupt);
      expect(Cause.hasInterruptsOnly(interrupted)).toBe(true);
    })
);
