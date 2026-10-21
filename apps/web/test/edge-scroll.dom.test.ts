import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { isoFromDay } from "../src/layout/navigation.js";
import { edgeFirstDay } from "./edge-scroll-fixture.js";
import { nativeEdgeScene } from "./edge-scroll-native.js";

it.effect.each(["left", "right"] as const)(
  "native timed %s edge-scroll moves into a formerly clipped date and drops the current preview",
  (direction) =>
    Effect.gen(function* timedEdge() {
      const result = yield* Effect.scoped(
        nativeEdgeScene({
          direction,
          drop: true,
          scene: "timed-move",
          theme: "light",
          width: 900,
        })
      );

      const { proof } = result;
      expect(proof.clipped).toBe(true);
      expect(proof.after).not.toBe(proof.before);
      expect(proof.columnDate).toBe(
        isoFromDay(edgeFirstDay + (direction === "right" ? 13 : 0))
      );
      expect(proof.previewDate).toBe(proof.columnDate);
      expect(proof.topAfter).toBe(proof.topBefore);
      expect(result.completed?.range).toEqual(proof.previewRange);
      expect(
        Option.getOrUndefined(result.model.editing.gesture)?.range
      ).toEqual(proof.previewRange);

      const { html } = yield* renderToString(
        { init: () => ({ model: result.model }), view },
        { isHydratable: false }
      );

      expect(html).toContain('class="gesture-preview"');
    })
);

it.effect.each(["left", "right"] as const)(
  "native all-day %s resize can cross clipped dates without scrolling hours",
  (direction) =>
    Effect.gen(function* allDayEdge() {
      const result = yield* Effect.scoped(
        nativeEdgeScene({
          direction,
          drop: true,
          scene: "all-day-resize",
          theme: "dark",
          width: 1440,
        })
      );

      const { proof } = result;
      expect(proof.clipped).toBe(true);
      expect(proof.after).not.toBe(proof.before);
      expect(proof.columnDate).toBe(
        isoFromDay(edgeFirstDay + (direction === "right" ? 13 : 0))
      );
      expect(proof.previewDate).toBe(proof.columnDate);
      expect(proof.previewRange.allDay).toBe(true);
      expect(proof.topAfter).toBe(proof.topBefore);
      expect(result.completed?.range).toEqual(proof.previewRange);
    })
);

it.effect(
  "a wide non-overflowing drag stays on the same date and cannot invent horizontal scroll",
  () =>
    Effect.gen(function* noOverflow() {
      const { proof } = yield* Effect.scoped(
        nativeEdgeScene({
          scene: "wide-no-overflow",
          theme: "light",
          width: 1440,
        })
      );

      expect(proof.maximum).toBe(0);
      expect(proof.after).toBe(proof.before);
      expect(proof.actorPhase).toBe("dragging");
      expect(proof.columnDate).toBe(isoFromDay(edgeFirstDay));
      expect(proof.previewDate).toBe(proof.columnDate);
    })
);
