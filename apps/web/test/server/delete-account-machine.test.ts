import { AccountDeletionUnavailable } from "@calendar/core/contracts";
import { it, expect } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";

import { deleteOwnedCalendarAccount } from "../../src/server/delete-account.js";
import type { AccountDeletionEffects } from "../../src/server/delete-account.js";
import { liveAdmission } from "../../src/server/live-admission.js";

type Step = Parameters<AccountDeletionEffects["run"]>[0];

it.effect.prop(
  "deletion histories preserve the commit boundary, resume only pre-commit failures and tolerate cleanup failures",
  {
    failures: Schema.Array(
      Schema.Literals(["quiesce", "stop", "commit", "finalize", "resume"])
    ).check(Schema.isMaxLength(6)),
  },
  ({ failures }) =>
    Effect.gen(function* deletionHistory() {
      const observed: Step[] = [];
      const expected: Step[] = ["quiesce"];

      if (!failures.includes("quiesce")) {
        expected.push(
          "stop",
          "commit",
          failures.includes("commit") ? "resume" : "finalize"
        );
      }

      const deleted =
        !failures.includes("quiesce") && !failures.includes("commit");

      const result = yield* deleteOwnedCalendarAccount({
        run: (step) =>
          Effect.sync(() => {
            observed.push(step);
          }).pipe(
            Effect.andThen(
              failures.includes(step)
                ? Effect.fail(new AccountDeletionUnavailable())
                : Effect.void
            )
          ),
      }).pipe(Effect.result);

      expect(observed).toEqual(expected);
      expect(Result.isSuccess(result)).toBe(deleted);
    })
);

it.effect.prop(
  "live admission histories pause once, reject duplicate acquisitions and resume without another authority",
  {
    history: Schema.Array(Schema.Literals(["Pause", "Resume"])).check(
      Schema.isMaxLength(24)
    ),
  },
  ({ history }) =>
    Effect.sync(() => {
      const admission = liveAdmission();
      let expected = true;

      for (const step of history) {
        if (step === "Pause") {
          expect(admission.pause()).toBe(expected);
          expected = false;
        } else {
          admission.resume();
          expected = true;
        }

        expect(admission.accepts()).toBe(expected);
      }
    })
);
