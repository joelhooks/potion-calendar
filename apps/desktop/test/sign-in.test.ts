import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Match, Ref, Schema } from "effect";

import { DesktopError } from "../src/config.js";
import { runSignIn } from "../src/sign-in-machine.js";

it.effect.prop(
  "sign-in redeems only a received token and preserves each terminal result",
  {
    accepted: Arbitrary.schema(Schema.Boolean),
    callback: Arbitrary.schema(
      Schema.Literals(["token", "timeout", "failure"])
    ),
  },
  ({ callback, accepted }) =>
    Effect.gen(function* terminalSignIn() {
      const redeemed = yield* Ref.make<readonly string[]>([]);

      const wait = Match.value(callback).pipe(
        Match.when("token", () => Effect.succeedSome("one-shot-token")),
        Match.when("timeout", () => Effect.succeedNone),
        Match.orElse(() =>
          Effect.fail(new DesktopError({ message: "Listener unavailable" }))
        )
      );

      const result = yield* runSignIn({
        redeem: (token) =>
          Ref.update(redeemed, (tokens) => [...tokens, token]).pipe(
            Effect.flatMap(() =>
              accepted
                ? Effect.void
                : Effect.fail(
                    new DesktopError({ message: "Redemption refused" })
                  )
            )
          ),
        wait,
      });

      expect(yield* Ref.get(redeemed)).toEqual(
        callback === "token" ? ["one-shot-token"] : []
      );

      const expected = Match.value(callback).pipe(
        Match.when("timeout", () => "timedOut"),
        Match.when("token", () => (accepted ? "signedIn" : "failed")),
        Match.orElse(() => "failed")
      );

      expect(result).toBe(expected);
    })
);
