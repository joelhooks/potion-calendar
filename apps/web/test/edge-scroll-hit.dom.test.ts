import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { nativeEdgeScene } from "./edge-scroll-native.js";

it.effect(
  "the same pointer event samples its date after scrolling, not the old column geometry",
  () =>
    Effect.gen(function* freshHorizontalHit() {
      const { proof } = yield* Effect.scoped(
        nativeEdgeScene({
          edgeDistance: 27,
          scene: "timed-move",
          theme: "light",
          width: 900,
        })
      );

      expect(proof.after).toBe(27);
      expect(proof.edgeColumnDate).toBe("2026-10-29");
      expect(proof.edgePreviewDate).toBe(proof.edgeColumnDate);
    })
);
