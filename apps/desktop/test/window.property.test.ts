import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";

import { parseCallback } from "../src/callback.js";
import { clampWindow } from "../src/window-state.js";

const Geometry = Schema.Struct({
  height: Schema.Int.check(Schema.isBetween({ maximum: 4096, minimum: 1 })),
  width: Schema.Int.check(Schema.isBetween({ maximum: 4096, minimum: 1 })),
  x: Schema.Int.check(Schema.isBetween({ maximum: 20_000, minimum: -20_000 })),
  y: Schema.Int.check(Schema.isBetween({ maximum: 20_000, minimum: -20_000 })),
});

it.effect.prop(
  "restoration always fits the selected display and is idempotent",
  {
    display: Arbitrary.schema(Geometry),
    saved: Arbitrary.schema(Geometry),
  },
  ({ display, saved }) =>
    Effect.sync(() => {
      const result = clampWindow(saved, [display]);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.x).toBeGreaterThanOrEqual(display.x);
      expect(result.y).toBeGreaterThanOrEqual(display.y);
      expect(result.x + result.width).toBeLessThanOrEqual(
        display.x + display.width
      );
      expect(result.y + result.height).toBeLessThanOrEqual(
        display.y + display.height
      );
      expect(clampWindow(result, [display])).toEqual(result);
    })
);

const Secret = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));

it.effect.prop(
  "callback accepts exactly the generated secret state and never a changed state",
  {
    state: Arbitrary.schema(Secret),
    token: Arbitrary.schema(Secret),
  },
  ({ state, token }) =>
    Effect.sync(() => {
      const callback = `/callback?token=${token}&state=${state}`;
      const wrong = `${state.slice(0, 63)}${state.endsWith("a") ? "b" : "a"}`;
      expect(parseCallback(callback, "127.0.0.1:49152", state)).toBe(token);
      expect(parseCallback(callback, "127.0.0.1:49152", wrong)).toBeNull();
    })
);
