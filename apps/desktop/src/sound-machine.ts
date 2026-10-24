import { watchActor } from "@calendar/capability/actor-watch";
import { PromptSound } from "@calendar/core/desktop-bridge";
import type {
  DesktopPreferencesValue,
  PlayablePromptSound,
} from "@calendar/core/desktop-bridge";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import { Effect, Schema } from "effect";

import type { DesktopError } from "./config.js";

export type SoundLoadOutcome = "ready" | "failed" | "timedOut";

export const soundMachine = (
  load: (
    sound: typeof PlayablePromptSound.Type
  ) => Effect.Effect<void, DesktopError>
) => {
  const prepare = createEffectLogic({
    effect: ({ input }: { readonly input: typeof PlayablePromptSound.Type }) =>
      load(input),
  });

  const deadline = createEffectLogic({ effect: Effect.sleep("2 seconds") });

  return setupEffect({
    actors: { deadline, prepare },
    schemas: {
      context: Schema.Struct({
        outcome: Schema.Literals(["ready", "failed", "timedOut"]),
        sound: PromptSound,
      }),
      input: PromptSound,
    },
  }).createMachine({
    context: ({ input }) => ({ outcome: "ready", sound: input }),
    initial: "idle",
    output: ({ context }): SoundLoadOutcome => context.outcome,
    states: {
      failed: { type: "final" },
      idle: {
        always: ({ context }) => ({
          target: context.sound === "none" ? "ready" : "loading",
        }),
      },
      loading: {
        invoke: [
          {
            input: ({ context }) =>
              context.sound === "none" ? "blip" : context.sound,
            onDone: { target: "ready" },
            onError: ({ context }) => ({
              context: { ...context, outcome: "failed" },
              target: "failed",
            }),
            src: "prepare",
          },
          {
            onDone: ({ context }) => ({
              context: { ...context, outcome: "timedOut" },
              target: "timedOut",
            }),
            src: "deadline",
          },
        ],
      },
      ready: { type: "final" },
      timedOut: { type: "final" },
    },
  });
};

export const loadSound = Effect.fn("Desktop.loadSound")(function* loadSound(
  sound: typeof PromptSound.Type,
  load: (
    sound: typeof PlayablePromptSound.Type
  ) => Effect.Effect<void, DesktopError>
) {
  const actor = yield* createEffectActor(soundMachine(load), { input: sound });
  yield* watchActor("desktopPromptSound", actor);

  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- The pinned bridge exposes unknown machine failures; orDie keeps unexpected actor failure as a defect.
  return yield* join(actor).pipe(Effect.orDie);
}, Effect.scoped);

export interface SoundPlaybackWork {
  readonly load: (
    sound: typeof PlayablePromptSound.Type
  ) => Effect.Effect<void, DesktopError>;
  readonly play: (
    sound: typeof PlayablePromptSound.Type
  ) => Effect.Effect<void, DesktopError>;
}

export interface SoundRevealWork extends SoundPlaybackWork {
  readonly reveal: Effect.Effect<void, DesktopError>;
}

export const revealWithSound = Effect.fn("Desktop.revealWithSound")(
  function* revealWithSound(
    sound: typeof PromptSound.Type,
    work: SoundRevealWork
  ) {
    const outcome = yield* loadSound(sound, work.load);
    yield* work.reveal;

    if (outcome === "ready" && sound !== "none") {
      yield* work.play(sound);
    }

    return outcome;
  }
);

export const soundPreviewEnabled = (
  preferences: DesktopPreferencesValue,
  sound: typeof PromptSound.Type
): boolean =>
  preferences.menuBar &&
  preferences.promptMinutes !== null &&
  preferences.promptSound === sound &&
  sound !== "none";

export interface SoundPreviewWork {
  readonly active: Effect.Effect<boolean>;
  readonly enabled: Effect.Effect<boolean>;
  readonly prepare: Effect.Effect<
    SoundPlaybackWork & { readonly cancel: Effect.Effect<void> },
    DesktopError
  >;
}

export const previewWithSound = Effect.fn("Desktop.previewWithSound")(
  function* previewWithSound(
    sound: typeof PromptSound.Type,
    work: SoundPreviewWork
  ) {
    if (sound === "none" || (yield* work.active) || !(yield* work.enabled)) {
      return false;
    }

    const prepared = yield* work.prepare;

    return yield* Effect.gen(function* previewAttempt() {
      const outcome = yield* loadSound(sound, prepared.load);

      if (
        outcome !== "ready" ||
        (yield* work.active) ||
        !(yield* work.enabled)
      ) {
        return false;
      }

      yield* prepared.play(sound);

      return true;
    }).pipe(Effect.ensuring(prepared.cancel));
  }
);
