import { PromptSoundRequest, promptWire } from "@calendar/core/desktop-bridge";
import type { PromptSoundReply } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { createPromptBridge } from "../src/prompt-client.js";

const unexpected = (): never => {
  throw new Error("Sound work must not use view or event actions");
};

it.effect(
  "the actual isolated prompt bridge decodes sound requests and encodes play acknowledgements",
  () =>
    Effect.gen(function* isolatedSoundBridge() {
      const listeners = new Set<(message: string) => void>();
      const requests: (typeof PromptSoundRequest.Type)[] = [];
      const replies: string[] = [];
      const counts = { rejected: 0 };

      const bridge = createPromptBridge({
        act: unexpected,
        read: unexpected,
        rejected: () => {
          counts.rejected += 1;
        },
        soundReply: (message) => {
          replies.push(message);
        },
        subscribe: unexpected,
        subscribeSound: (receive) => {
          listeners.add(receive);

          return () => {
            listeners.delete(receive);
          };
        },
      });

      const stop = bridge.onSound?.((request) => {
        requests.push(request);
      });

      const expected = PromptSoundRequest.cases.Load.make({
        request: 12,
        sound: "bell",
      });

      const message = yield* Schema.encodeEffect(promptWire.sound)(expected);

      for (const receive of listeners) {
        receive(message);
        receive('{"_tag":"Load","request":12,"sound":"none"}');
        receive('{"_tag":"Load","request":12,"sound":"external-file"}');
        receive('{"_tag":"Play","request":"12","sound":"bell"}');
      }

      expect(requests).toEqual([expected]);
      expect(counts.rejected).toBe(3);
      bridge.soundReply?.({ phase: "play", ready: true, request: 12 });
      const decoded: (typeof PromptSoundReply.Type)[] = [];

      for (const reply of replies) {
        decoded.push(yield* Schema.decodeEffect(promptWire.soundReply)(reply));
      }

      expect(decoded).toEqual([{ phase: "play", ready: true, request: 12 }]);
      stop?.();
      expect(listeners.size).toBe(0);
    })
);
