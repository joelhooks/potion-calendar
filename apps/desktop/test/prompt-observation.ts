import { expect } from "@effect/vitest";
import { waitFor } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import { Effect } from "effect";

import type { promptMachine } from "../src/prompt-machine.js";

export const settledPromptAt = Effect.fn("FakePrompt.observeClock")(
  function* settledPromptAt(
    actor: EffectActor<ReturnType<typeof promptMachine>>,
    now: number
  ) {
    yield* Effect.yieldNow;
    yield* Effect.yieldNow;
    expect(actor.getSnapshot().context.now).toBe(now);

    return yield* waitFor(
      actor,
      (snapshot) =>
        snapshot.context.now === now &&
        (snapshot.matches("idle") || snapshot.matches("visible")),
      { timeout: "1 second" }
    ).pipe(Effect.orDie);
  }
);
