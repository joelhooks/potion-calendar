import { IcsSaveOutcome } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Option } from "effect";

import { nativeIcsBridgeFixture } from "./ics-bridge-main-fixture.js";
import { calendarText, icsSaveFixture } from "./ics-save-fixture.js";

it.effect(
  "the real preload and main handler wait for write success before Saved",
  () =>
    Effect.gen(function* nativeBridgeReceipt() {
      const writing = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();
      const finished = yield* Deferred.make<boolean>();
      const native = icsSaveFixture();

      const fixture = yield* nativeIcsBridgeFixture({
        ...native.port,
        write: (path, bytes) =>
          Deferred.succeed(writing, true).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(native.port.write(path, bytes))
          ),
      });

      const save = Option.getOrThrow(
        Option.fromUndefinedOr(fixture.bridge.saveIcs)
      );

      const request = {
        bytes: new TextEncoder().encode(calendarText()),
        suggestedName: "events.ics",
      };

      const scope = yield* Effect.scope;

      const pending = yield* Effect.promise(
        // @effect-diagnostics-next-line asyncFunction:off -- This invokes the actual isolated bridge codec and actual main handler through their native Promise boundary.
        async () => await save(request)
      ).pipe(
        Effect.onExit(() => Deferred.succeed(finished, true)),
        Effect.forkIn(scope)
      );

      const first = yield* Effect.raceFirst(
        Deferred.await(writing).pipe(Effect.as("writing")),
        Deferred.await(finished).pipe(Effect.as("finished"))
      );

      expect(first).toBe("writing");
      expect(pending.pollUnsafe()).toBeUndefined();
      expect(native.writes).toEqual([]);
      yield* Deferred.succeed(release, true);
      expect(yield* Fiber.join(pending)).toEqual(
        IcsSaveOutcome.cases.Saved.make({})
      );
      expect(native.writes).toHaveLength(1);
      expect(native.writes[0]?.path).toBe("/chosen/export.ics");
      expect(native.writes[0]?.bytes).toEqual(request.bytes);
      expect(fixture.calls).toHaveLength(1);
      expect(fixture.state.rejections).toBe(0);
    })
);
