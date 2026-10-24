import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";

import { promptMenuPosition } from "../src/client/prompt-menu.js";

it.effect.prop(
  "a measured prompt menu stays within the existing client viewport without resizing its window",
  {
    anchorX: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: -100 }))
    ),
    anchorY: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: -100 }))
    ),
    height: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: 120 }))
    ),
    width: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: 180 }))
    ),
  },
  ({ anchorX, anchorY, height, width }) =>
    Effect.sync(() => {
      const menu = { height: 88, width: 150 };

      const position = promptMenuPosition(
        { bottom: anchorY, right: anchorX },
        menu,
        { height, width }
      );

      expect(position.left).toBeGreaterThanOrEqual(8);
      expect(position.top).toBeGreaterThanOrEqual(8);
      expect(position.left + menu.width).toBeLessThanOrEqual(width - 8);
      expect(position.top + menu.height).toBeLessThanOrEqual(height - 8);
    })
);
