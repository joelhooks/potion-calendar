// oxlint-disable promise/avoid-new -- One controlled Web Audio resume Promise must settle after cancellation without starting an Effect runtime.
import { PromptSoundRequest } from "@calendar/core/desktop-bridge";
import type { PromptSoundReply } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  createSoundReceiver,
  prepareAudio,
  toneEnvelope,
} from "../src/client/sound.js";
import type { ResumableAudio } from "../src/client/sound.js";
import { DesktopError } from "../src/config.js";

interface FakeAudio extends ResumableAudio {
  state: AudioContextState;
}

it.effect.each(["running", "suspended", "rejected"] as const)(
  "audio resume ending %s reports readiness rather than assuming autoplay",
  (outcome) =>
    Effect.gen(function* autoplayHistory() {
      const context: FakeAudio = {
        // @effect-diagnostics-next-line asyncFunction:off -- The Web Audio fake models rejected or still-suspended native resume without an Effect runner.
        resume: async () => {
          await Promise.resolve();

          if (outcome === "rejected") {
            throw new Error("Autoplay denied");
          }

          context.state = outcome;
        },
        state: "suspended",
      };

      const ready = yield* Effect.tryPromise({
        catch: (cause) =>
          new DesktopError({ cause, message: "Fixture failed" }),
        // @effect-diagnostics-next-line asyncFunction:off -- This awaits the renderer's native Promise without starting another Effect runtime.
        try: async () => await prepareAudio(context),
      });

      expect(ready).toBe(outcome === "running");
    })
);

it.effect(
  "only a prepared matching request may play, once; cancellation refuses replay",
  () =>
    Effect.gen(function* soundRequests() {
      const played: string[] = [];
      const replies: (typeof PromptSoundReply.Type)[] = [];

      const receive = createSoundReceiver(
        {
          // @effect-diagnostics-next-line asyncFunction:off -- The fake Web Audio port preserves the native Promise seam.
          load: async () => await Promise.resolve(true),
          play: (sound) => {
            played.push(sound);

            return true;
          },
        },
        (reply) => {
          replies.push(reply);
        }
      );

      const dispatch = (request: Parameters<typeof receive>[0]) =>
        Effect.tryPromise({
          catch: (cause) =>
            new DesktopError({ cause, message: "Sound request failed" }),
          // @effect-diagnostics-next-line asyncFunction:off -- The isolated renderer consumes one typed request Promise.
          try: async () => {
            await receive(request);
          },
        });

      yield* dispatch(
        PromptSoundRequest.cases.Play.make({ request: 1, sound: "blip" })
      );
      expect(played).toEqual([]);
      yield* dispatch(
        PromptSoundRequest.cases.Load.make({ request: 2, sound: "bell" })
      );
      expect(played).toEqual([]);
      yield* dispatch(
        PromptSoundRequest.cases.Play.make({ request: 2, sound: "bell" })
      );
      yield* dispatch(
        PromptSoundRequest.cases.Play.make({ request: 2, sound: "bell" })
      );
      yield* dispatch(
        PromptSoundRequest.cases.Load.make({ request: 3, sound: "tap" })
      );
      yield* dispatch(PromptSoundRequest.cases.Cancel.make({ request: 3 }));
      yield* dispatch(
        PromptSoundRequest.cases.Play.make({ request: 3, sound: "tap" })
      );
      yield* dispatch(
        PromptSoundRequest.cases.Load.make({ request: 4, sound: "bell" })
      );
      yield* dispatch(
        PromptSoundRequest.cases.Play.make({ request: 4, sound: "tap" })
      );
      expect(played).toEqual(["bell"]);
      expect(replies).toEqual([
        { phase: "play", ready: false, request: 1 },
        { phase: "load", ready: true, request: 2 },
        { phase: "play", ready: true, request: 2 },
        { phase: "play", ready: false, request: 2 },
        { phase: "load", ready: true, request: 3 },
        { phase: "play", ready: false, request: 3 },
        { phase: "load", ready: true, request: 4 },
        { phase: "play", ready: false, request: 4 },
      ]);
    })
);

it.effect(
  "cancelled renderer preparation cannot acknowledge or play after a late resume",
  () =>
    Effect.gen(function* lateRendererResume() {
      const completion = {
        resolve: (_ready: boolean): void => {
          throw new Error("Resume was not started");
        },
      };

      // @effect-diagnostics-next-line newPromise:off -- This owned Web Audio fixture resumes after cancellation without another Effect runner.
      const pending = new Promise<boolean>((resolve) => {
        completion.resolve = resolve;
      });

      const replies: (typeof PromptSoundReply.Type)[] = [];
      const played: string[] = [];

      const receive = createSoundReceiver(
        {
          // @effect-diagnostics-next-line asyncFunction:off -- This controlled Web Audio Promise resumes only after its owning request has been cancelled.
          load: async () => await pending,
          play: (sound) => {
            played.push(sound);

            return true;
          },
        },
        (reply) => {
          replies.push(reply);
        }
      );

      const loading = receive(
        PromptSoundRequest.cases.Load.make({ request: 9, sound: "tap" })
      );

      yield* Effect.tryPromise({
        catch: (cause) => new DesktopError({ cause, message: "Cancel failed" }),
        // @effect-diagnostics-next-line asyncFunction:off -- This awaits one local IPC receiver operation at the native Promise boundary.
        try: async () => {
          await receive(PromptSoundRequest.cases.Cancel.make({ request: 9 }));
        },
      });
      completion.resolve(true);
      yield* Effect.tryPromise({
        catch: (cause) =>
          new DesktopError({ cause, message: "Late load failed" }),
        // @effect-diagnostics-next-line asyncFunction:off -- The cancelled preparation's late Promise must finish without producing readiness.
        try: async () => {
          await loading;
        },
      });
      expect(replies).toEqual([]);
      yield* Effect.tryPromise({
        catch: (cause) => new DesktopError({ cause, message: "Replay failed" }),
        // @effect-diagnostics-next-line asyncFunction:off -- This typed replay probes the existing request identity fence.
        try: async () => {
          await receive(
            PromptSoundRequest.cases.Play.make({ request: 9, sound: "tap" })
          );
        },
      });
      expect(played).toEqual([]);
      expect(replies).toEqual([{ phase: "play", ready: false, request: 9 }]);
    })
);

it.effect(
  "owned synthesized tones have distinct short high, decaying and click-like envelopes",
  () =>
    Effect.sync(() => {
      const blip = toneEnvelope("blip");
      const bell = toneEnvelope("bell");
      const tap = toneEnvelope("tap");
      expect(blip.frequency).toBeGreaterThan(bell.frequency);
      expect(bell.duration).toBeGreaterThan(blip.duration);
      expect(tap.duration).toBeLessThan(blip.duration);

      for (const tone of [blip, bell, tap]) {
        expect(tone.duration).toBeLessThan(1);
        expect(tone.gain).toBeGreaterThan(0);
        expect(tone.gain).toBeLessThan(0.2);
      }
    })
);
