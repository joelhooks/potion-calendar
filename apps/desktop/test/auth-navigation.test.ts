import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Match, Schema } from "effect";

import { authNavigation } from "../src/auth-navigation.js";

it.effect.prop(
  "only an existing partition session sends account actions to the browser instead of signing in again",
  {
    session: Arbitrary.schema(Schema.Literals(["absent", "secure", "plain"])),
    unrelated: Arbitrary.schema(Schema.Array(Schema.String)),
  },
  ({ session, unrelated }) =>
    Effect.sync(() => {
      const names = unrelated.map((name) => `other-${name}`);

      const cookies = Match.value(session).pipe(
        Match.when("secure", () => [
          ...names,
          "__Secure-better-auth.session_token",
        ]),
        Match.when("plain", () => [...names, "better-auth.session_token"]),
        Match.orElse(() => names)
      );

      expect(authNavigation(cookies)).toBe(
        session === "absent" ? "signIn" : "browserAccount"
      );
    })
);
