import {
  PromptSoundReply,
  PromptSoundRequest,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Queue, Schema } from "effect";
import { TestClock } from "effect/testing";

import { revealWithSound } from "../src/sound-machine.js";
import { preparePromptSound } from "../src/sound-port.js";

it.effect(
  "only the matching load reply releases reveal; wrong IDs and play replies cannot",
  () =>
    Effect.gen(function* acknowledgementHistory() {
      const requests = yield* Queue.unbounded<typeof PromptSoundRequest.Type>();
      const listeners = new Set<(message: string) => void>();
      const steps: string[] = [];

      const port = {
        send: (request: typeof PromptSoundRequest.Type) => {
          Queue.offerUnsafe(requests, request);
        },
        subscribe: (receive: (message: string) => void) => {
          listeners.add(receive);

          return () => {
            listeners.delete(receive);
          };
        },
      };

      const fiber = yield* revealWithSound("bell", {
        load: (tone) => preparePromptSound(port, 42, tone),
        play: () =>
          Effect.sync(() => {
            steps.push("play");
          }),
        reveal: Effect.sync(() => {
          steps.push("reveal");
        }),
      }).pipe(Effect.forkChild);

      expect(yield* Queue.take(requests)).toEqual(
        PromptSoundRequest.cases.Load.make({ request: 42, sound: "bell" })
      );

      for (const reply of [
        PromptSoundReply.make({ phase: "load", ready: true, request: 41 }),
        PromptSoundReply.make({ phase: "play", ready: true, request: 42 }),
      ]) {
        const message = yield* Schema.encodeEffect(
          Schema.fromJsonString(PromptSoundReply)
        )(reply);

        for (const receive of listeners) {
          receive(message);
        }
      }

      yield* TestClock.adjust(1999);
      expect(steps).toEqual([]);

      const matching = yield* Schema.encodeEffect(
        Schema.fromJsonString(PromptSoundReply)
      )(PromptSoundReply.make({ phase: "load", ready: true, request: 42 }));

      for (const receive of listeners) {
        receive(matching);
      }

      expect(yield* Fiber.join(fiber)).toBe("ready");
      expect(steps).toEqual(["reveal", "play"]);
      expect(listeners.size).toBe(0);
    })
);

it.effect(
  "deadline cancellation removes the reply listener and rejects late readiness",
  () =>
    Effect.gen(function* cancelledAcknowledgement() {
      const requests = yield* Queue.unbounded<typeof PromptSoundRequest.Type>();
      const listeners = new Set<(message: string) => void>();
      const steps: string[] = [];

      const fiber = yield* revealWithSound("tap", {
        load: (tone) =>
          preparePromptSound(
            {
              send: (request) => {
                Queue.offerUnsafe(requests, request);
              },
              subscribe: (receive) => {
                listeners.add(receive);

                return () => {
                  listeners.delete(receive);
                };
              },
            },
            7,
            tone
          ),
        play: () =>
          Effect.sync(() => {
            steps.push("play");
          }),
        reveal: Effect.sync(() => {
          steps.push("reveal");
        }),
      }).pipe(Effect.forkChild);

      expect(yield* Queue.take(requests)).toEqual(
        PromptSoundRequest.cases.Load.make({ request: 7, sound: "tap" })
      );
      yield* TestClock.adjust(2000);
      expect(yield* Fiber.join(fiber)).toBe("timedOut");
      expect(yield* Queue.size(requests)).toBe(1);
      expect(yield* Queue.take(requests)).toEqual(
        PromptSoundRequest.cases.Cancel.make({ request: 7 })
      );
      expect(listeners.size).toBe(0);

      const late = yield* Schema.encodeEffect(
        Schema.fromJsonString(PromptSoundReply)
      )(PromptSoundReply.make({ phase: "load", ready: true, request: 7 }));

      for (const receive of listeners) {
        receive(late);
      }

      yield* TestClock.adjust(10_000);
      expect(steps).toEqual(["reveal"]);
    })
);
