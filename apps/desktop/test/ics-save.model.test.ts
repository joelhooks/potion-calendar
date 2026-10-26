import { IcsSaveOutcome } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { createEffectActor, join } from "@xstate/effect";
import {
  Arbitrary,
  Deferred,
  Effect,
  Exit,
  Match,
  Option,
  Schema,
  Scope,
} from "effect";

import { IcsDialogOutcome, icsSaveMachine } from "../src/ics-save.js";

it.effect.prop(
  "dialog, write and interruption histories settle once without writing before explicit path acceptance",
  {
    choice: Arbitrary.schema(
      Schema.Literals(["chosen", "cancelled", "failed"])
    ),
    interrupted: Arbitrary.schema(Schema.Boolean),
    writeFailed: Arbitrary.schema(Schema.Boolean),
  },
  ({ choice, interrupted, writeFailed }) =>
    Effect.gen(function* saveHistory() {
      const entered = yield* Deferred.make<boolean>();
      const dialog = yield* Deferred.make<typeof IcsDialogOutcome.Type>();
      const writing = yield* Deferred.make<boolean>();

      const write = yield* Deferred.make<
        | typeof IcsSaveOutcome.cases.Saved.Type
        | typeof IcsSaveOutcome.cases.Failed.Type
      >();

      const calls: string[] = [];
      const owned = yield* Scope.make();
      yield* Effect.addFinalizer(() => Scope.close(owned, Exit.void));

      const actor = yield* createEffectActor(
        icsSaveMachine({
          choose: Effect.sync(() => {
            calls.push("dialog");
          }).pipe(
            Effect.andThen(Deferred.succeed(entered, true)),
            Effect.andThen(Deferred.await(dialog))
          ),
          write: Effect.sync(() => {
            calls.push("write");
          }).pipe(
            Effect.andThen(Deferred.succeed(writing, true)),
            Effect.andThen(Deferred.await(write))
          ),
        })
      ).pipe(Effect.provideService(Scope.Scope, owned));

      yield* Deferred.await(entered);
      expect(actor.getSnapshot().matches("choosing")).toBe(true);
      expect(calls).toEqual(["dialog"]);

      const dialogOutcome = Match.value(choice).pipe(
        Match.when("chosen", () => IcsDialogOutcome.cases.Chosen.make({})),
        Match.when("cancelled", () =>
          IcsDialogOutcome.cases.Cancelled.make({})
        ),
        Match.when("failed", () =>
          IcsDialogOutcome.cases.Failed.make({ reason: "dialog" })
        ),
        Match.exhaustive
      );

      if (interrupted) {
        yield* Scope.close(owned, Exit.void);
        yield* Deferred.succeed(dialog, dialogOutcome);
        expect(calls).toEqual(["dialog"]);
        expect(actor.getSnapshot().status).not.toBe("done");

        return;
      }

      yield* Deferred.succeed(dialog, dialogOutcome);

      const expected = Match.value(choice).pipe(
        Match.when("chosen", () =>
          writeFailed
            ? IcsSaveOutcome.cases.Failed.make({ reason: "write" })
            : IcsSaveOutcome.cases.Saved.make({})
        ),
        Match.when("cancelled", () => IcsSaveOutcome.cases.Cancelled.make({})),
        Match.when("failed", () =>
          IcsSaveOutcome.cases.Failed.make({ reason: "dialog" })
        ),
        Match.exhaustive
      );

      if (choice === "chosen") {
        yield* Deferred.await(writing);
        expect(actor.getSnapshot().matches("writing")).toBe(true);
        expect(Option.isNone(actor.getSnapshot().context.outcome)).toBe(true);
        expect(calls).toEqual(["dialog", "write"]);
        yield* Deferred.succeed(
          write,
          writeFailed
            ? IcsSaveOutcome.cases.Failed.make({ reason: "write" })
            : IcsSaveOutcome.cases.Saved.make({})
        );
      }

      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Unexpected machine failures must fail the generated lifecycle witness rather than become a save outcome.
      const outcome = yield* join(actor).pipe(Effect.orDie);
      expect(Option.getOrThrow(outcome)).toEqual(expected);
      expect(calls).toEqual(
        choice === "chosen" ? ["dialog", "write"] : ["dialog"]
      );
      yield* Deferred.succeed(dialog, IcsDialogOutcome.cases.Chosen.make({}));
      yield* Deferred.succeed(write, IcsSaveOutcome.cases.Saved.make({}));
      expect(actor.getSnapshot().context.outcome).toEqual(
        Option.some(expected)
      );
      expect(calls).toEqual(
        choice === "chosen" ? ["dialog", "write"] : ["dialog"]
      );
    })
);
