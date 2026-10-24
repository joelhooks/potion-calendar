import { expect, it } from "@effect/vitest";
import { createEffectActor, join } from "@xstate/effect";
import { Arbitrary, Deferred, Effect, Fiber, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";

import { DesktopError } from "../src/config.js";
import { revealWithSound, soundMachine } from "../src/sound-machine.js";

it.effect.prop(
  "readiness and known failure settle once and preserve the requested tone",
  {
    failed: Arbitrary.schema(Schema.Boolean),
    sound: Arbitrary.schema(Schema.Literals(["blip", "bell", "tap"])),
  },
  ({ failed, sound }) =>
    Effect.gen(function* loadHistory() {
      const entered = yield* Deferred.make<boolean>();
      const result = yield* Deferred.make<boolean, DesktopError>();
      const calls = yield* Ref.make<string[]>([]);

      const fiber = yield* revealWithSound(sound, {
        load: (tone) =>
          Ref.update(calls, (rows) => [...rows, `load:${tone}`]).pipe(
            Effect.andThen(Deferred.succeed(entered, true)),
            Effect.andThen(Deferred.await(result)),
            Effect.asVoid
          ),
        play: (tone) => Ref.update(calls, (rows) => [...rows, `play:${tone}`]),
        reveal: Ref.update(calls, (rows) => [...rows, "reveal"]),
      }).pipe(Effect.forkChild);

      yield* Deferred.await(entered);
      expect(yield* Ref.get(calls)).toEqual([`load:${sound}`]);
      yield* TestClock.adjust(1999);
      expect(yield* Ref.get(calls)).toEqual([`load:${sound}`]);

      yield* failed
        ? Deferred.fail(result, new DesktopError({ message: "Audio denied" }))
        : Deferred.succeed(result, true);

      expect(yield* Fiber.join(fiber)).toBe(failed ? "failed" : "ready");
      expect(yield* Ref.get(calls)).toEqual(
        failed
          ? [`load:${sound}`, "reveal"]
          : [`load:${sound}`, "reveal", `play:${sound}`]
      );
      yield* TestClock.adjust(10_000);
      expect(yield* Ref.get(calls)).toHaveLength(failed ? 2 : 3);
    })
);

it.effect(
  "the exact two-second deadline reveals silently and interrupts loading",
  () =>
    Effect.gen(function* deadlineHistory() {
      const entered = yield* Deferred.make<boolean>();
      const cancelled = yield* Deferred.make<boolean>();
      const revealed = yield* Ref.make(0);
      const played = yield* Ref.make(0);

      const actor = yield* createEffectActor(
        soundMachine(() =>
          Deferred.succeed(entered, true).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(cancelled, true))
          )
        ),
        { input: "bell" }
      );

      yield* Deferred.await(entered);
      expect(actor.getSnapshot().matches("loading")).toBe(true);
      yield* TestClock.adjust(1999);
      expect(actor.getSnapshot().status).toBe("active");
      yield* TestClock.adjust(1);
      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- The pinned bridge exposes unknown machine failures; unexpected failure must fail this lifecycle witness.
      expect(yield* join(actor).pipe(Effect.orDie)).toBe("timedOut");
      yield* Deferred.await(cancelled);

      const outcome = yield* revealWithSound("tap", {
        load: () => Effect.never,
        play: () => Ref.update(played, (count) => count + 1),
        reveal: Ref.update(revealed, (count) => count + 1),
      }).pipe(Effect.forkChild);

      yield* TestClock.adjust(2000);
      expect(yield* Fiber.join(outcome)).toBe("timedOut");
      expect(yield* Ref.get(revealed)).toBe(1);
      expect(yield* Ref.get(played)).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect(
  "No sound reveals immediately without preparing or playing audio",
  () =>
    Effect.gen(function* silentHistory() {
      const calls = yield* Ref.make<string[]>([]);

      expect(
        yield* revealWithSound("none", {
          load: () => Ref.update(calls, (rows) => [...rows, "load"]),
          play: () => Ref.update(calls, (rows) => [...rows, "play"]),
          reveal: Ref.update(calls, (rows) => [...rows, "reveal"]),
        })
      ).toBe("ready");
      expect(yield* Ref.get(calls)).toEqual(["reveal"]);
    })
);
