import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Match, Ref, Schema } from "effect";

import { runBrowserAccount } from "../src/browser-account-machine.js";
import { DesktopError } from "../src/config.js";

it.effect.prop(
  "account browser return reloads only after opening and regaining focus",
  {
    failed: Arbitrary.schema(Schema.Literals(["none", "open", "reload"])),
  },
  ({ failed }) =>
    Effect.gen(function* browserAccountHistory() {
      const history = yield* Ref.make<readonly string[]>([]);

      const step = (name: string) =>
        Ref.update(history, (events) => [...events, name]).pipe(
          Effect.flatMap(() =>
            name === failed
              ? Effect.fail(
                  new DesktopError({ message: "Browser account work failed" })
                )
              : Effect.void
          )
        );

      const outcome = yield* runBrowserAccount({
        open: step("open"),
        reload: step("reload"),
        wait: Ref.update(history, (events) => [...events, "focus"]),
      });

      const expected = Match.value(failed).pipe(
        Match.when("open", () => ["open"]),
        Match.orElse(() => ["open", "focus", "reload"])
      );

      expect(yield* Ref.get(history)).toEqual(expected);
      expect(outcome).toBe(failed === "none" ? "returned" : "failed");
    })
);
