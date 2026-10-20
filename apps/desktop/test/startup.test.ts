import { expect, it } from "@effect/vitest";
import { Deferred, Effect } from "effect";

import { startMain } from "../src/startup.js";

it.effect(
  "startup returns synchronously while Electron readiness remains pending",
  () =>
    Effect.gen(function* startupOrdering() {
      const ready = yield* Deferred.make<"ready">();
      const started = yield* Deferred.make<"started">();
      yield* Effect.addFinalizer(() => Deferred.succeed(ready, "ready"));

      // oxlint-disable-next-line typescript/no-confusing-void-expression -- This regression test inspects the runtime return to reject a readiness Promise that would block Electron module evaluation.
      const result = startMain(
        Deferred.await(ready).pipe(
          Effect.andThen(Deferred.succeed(started, "started")),
          Effect.asVoid
        )
      );

      expect(result).toBeUndefined();
      expect(yield* Deferred.isDone(started)).toBe(false);
      yield* Deferred.succeed(ready, "ready");
      expect(yield* Deferred.await(started)).toBe("started");
    }).pipe(Effect.scoped)
);
