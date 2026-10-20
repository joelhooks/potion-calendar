import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { layoutTimed } from "../src/layout/overlap.js";

it.effect(
  "rightward spans reuse free lanes and signed comparisons extend under an earlier start",
  () =>
    Effect.sync(() => {
      const placements = layoutTimed([
        { end: 660, id: "long", start: 540 },
        { end: 570, id: "short", start: 540 },
        { end: 600, id: "third", start: 540 },
        { end: 650, id: "later", start: 600 },
      ]);

      const later = placements.find((item) => item.id === "later");
      expect(later?.lane).toBe(1);
      expect(later?.left).toBe(0.05);
      expect(later?.width).toBe(0.95);

      const signed = layoutTimed([
        { end: 570, id: "short", start: 530 },
        { end: 660, id: "long", start: 540 },
        { end: 660, id: "reused", start: 600 },
      ]);

      const reused = signed.find((item) => item.id === "reused");
      expect(reused?.lane).toBe(0);
      expect(reused?.left).toBe(0);
      expect(reused?.width).toBe(0.75);
    })
);

it.effect("reach-back stops when a left lane has two conflicting cards", () =>
  Effect.sync(() => {
    const placements = layoutTimed([
      { end: 600, id: "first", start: 540 },
      { end: 720, id: "middle", start: 580 },
      { end: 700, id: "last", start: 600 },
    ]);

    expect(placements.find((item) => item.id === "middle")?.left).toBe(0.5);
  })
);

it.effect("selected chips paint above ordinary chips in every lane", () =>
  Effect.sync(() => {
    const placements = layoutTimed([
      { end: 600, id: "selected", selected: true, start: 540 },
      { end: 600, id: "other", start: 540 },
      { end: 600, id: "third", start: 540 },
    ]);

    const selected = placements.find((item) => item.id === "selected");
    expect(selected?.paint).toBeGreaterThan(
      Math.max(
        ...placements
          .filter((item) => item.id !== "selected")
          .map((item) => item.paint)
      )
    );
  })
);
