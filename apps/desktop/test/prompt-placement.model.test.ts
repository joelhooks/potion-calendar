import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import type { Point, Rectangle } from "electron";

import {
  promptPlacement,
  promptTopMargin,
  resizePromptWindow,
  revealPromptWindow,
} from "../src/prompt-placement.js";
import type { PromptPlacementScreen } from "../src/prompt-placement.js";

const Geometry = Schema.Struct({
  height: Schema.Int.check(Schema.isBetween({ maximum: 2400, minimum: 1 })),
  width: Schema.Int.check(Schema.isBetween({ maximum: 4000, minimum: 1 })),
  x: Schema.Int.check(Schema.isBetween({ maximum: 10_000, minimum: -10_000 })),
  y: Schema.Int.check(Schema.isBetween({ maximum: 10_000, minimum: -10_000 })),
});

it.effect.prop(
  "top-centre follows offset work areas and insets, saturating at the origin only for dimensions that cannot fit",
  {
    first: Arbitrary.schema(Geometry),
    inset: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 80, minimum: 1 }))
    ),
    second: Arbitrary.schema(Geometry),
    size: Arbitrary.schema(Geometry),
  },
  ({ first, second, size, inset }) =>
    Effect.sync(() => {
      expect(promptTopMargin).toBe(8);

      for (const display of [first, second]) {
        const area = {
          height: Math.max(1, display.height - inset),
          width: Math.max(1, display.width - inset),
          x: display.x + inset,
          y: display.y + inset,
        };

        const result = promptPlacement(area, size);
        expect(result.x).toBeGreaterThanOrEqual(area.x);
        expect(result.y).toBeGreaterThanOrEqual(area.y);

        if (size.width <= area.width) {
          expect(result.x + size.width).toBeLessThanOrEqual(
            area.x + area.width
          );
          const left = result.x - area.x;
          const right = area.x + area.width - result.x - size.width;
          expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
        } else {
          expect(result.x).toBe(area.x);
        }

        if (size.height <= area.height) {
          expect(result.y + size.height).toBeLessThanOrEqual(
            area.y + area.height
          );
          expect(result.y - area.y).toBe(
            area.height - size.height < 8 ? area.height - size.height : 8
          );
        } else {
          expect(result.y).toBe(area.y);
        }

        expect(promptPlacement(area, size)).toEqual(result);
      }
    })
);

const nativePlacement = (initial: Rectangle) => {
  let bounds = initial;
  let visible = false;
  const calls: string[] = [];
  const positions: Point[] = [];

  const window = {
    getBounds: () => ({ ...bounds }),
    isVisible: () => visible,
    setPosition: (x: number, y: number) => {
      calls.push("position");
      positions.push({ x, y });
      bounds = { ...bounds, x, y };
    },
    setSize: (width: number, height: number) => {
      calls.push("size");
      bounds = { ...bounds, height, width };
    },
    showInactive: () => {
      calls.push("showInactive");
      visible = true;
    },
  };

  return {
    calls,
    hide: () => {
      visible = false;
    },
    positions,
    window,
  };
};

it.effect.prop(
  "cursor display is read at hidden reveal, visible re-present never moves, and the next hidden reveal resolves a fresh display",
  { first: Arbitrary.schema(Geometry), second: Arbitrary.schema(Geometry) },
  ({ first, second }) =>
    Effect.sync(() => {
      const f = nativePlacement({ height: 140, width: 380, x: 0, y: 0 });
      const cursor = { x: -327, y: 91 };
      let area = first;
      const readPoints: Point[] = [];
      let primaryReads = 0;

      const displays: PromptPlacementScreen = {
        getCursorScreenPoint: () => cursor,
        getDisplayNearestPoint: (point) => {
          readPoints.push(point);

          return { workArea: area };
        },
        getPrimaryDisplay: () => {
          primaryReads += 1;

          return { workArea: second };
        },
      };

      revealPromptWindow(f.window, displays);
      const explicit = nativePlacement({ height: 140, width: 380, x: 0, y: 0 });
      revealPromptWindow(
        explicit.window,
        {
          ...displays,
          getDisplayNearestPoint: () => ({ workArea: first }),
        },
        { anchor: "topCenter", display: "cursor" }
      );
      expect(explicit.calls).toEqual(f.calls);
      expect(explicit.positions).toEqual(f.positions);
      expect(explicit.window.getBounds()).toEqual(f.window.getBounds());
      expect(readPoints).toEqual([cursor]);
      expect(primaryReads).toBe(0);
      expect(f.calls.at(-1)).toBe("showInactive");
      expect(f.positions).toHaveLength(1);
      expect(f.window.getBounds()).toEqual({
        ...promptPlacement(first, {
          height: Math.min(140, first.height),
          width: 380,
        }),
        height: Math.min(140, first.height),
        width: 380,
      });
      area = second;
      const before = f.window.getBounds();
      const calls = f.calls.length;
      revealPromptWindow(f.window, displays);
      expect(f.calls.slice(calls)).toEqual(["showInactive"]);
      expect(readPoints).toHaveLength(1);
      expect(f.window.getBounds()).toEqual(before);
      f.hide();
      revealPromptWindow(f.window, displays);
      expect(readPoints).toEqual([cursor, cursor]);
      expect(f.positions).toHaveLength(2);
      expect(f.window.getBounds()).toEqual({
        ...promptPlacement(second, {
          height: Math.min(before.height, second.height),
          width: 380,
        }),
        height: Math.min(before.height, second.height),
        width: 380,
      });
      expect(f.calls.at(-1)).toBe("showInactive");
    })
);

it.effect.each(["cursor", "nearest"] as const)(
  "failed %s lookup falls back to primary before inactive reveal",
  (failure) =>
    Effect.sync(() => {
      const f = nativePlacement({ height: 500, width: 380, x: 90, y: 600 });
      const primary = { height: 200, width: 800, x: -1600, y: 40 };
      let reads = 0;

      const displays: PromptPlacementScreen = {
        getCursorScreenPoint: () => {
          if (failure === "cursor") {
            throw new Error("Cursor screen lookup unavailable");
          }

          return { x: 1, y: 2 };
        },
        getDisplayNearestPoint: () => {
          throw new Error("Nearest display unavailable");
        },
        getPrimaryDisplay: () => {
          reads += 1;

          return { workArea: primary };
        },
      };

      revealPromptWindow(f.window, displays);
      expect(reads).toBe(1);
      expect(f.window.getBounds()).toEqual({
        height: 200,
        width: 380,
        x: -1390,
        y: 40,
      });
      expect(f.calls).toEqual(["size", "position", "showInactive"]);
    })
);

it.effect.prop(
  "visible resizing keeps x and y until bottom overflow, then only re-clamps y without reveal or recentering",
  {
    area: Arbitrary.schema(Geometry),
    height: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 2400, minimum: 1 }))
    ),
  },
  ({ area, height }) =>
    Effect.sync(() => {
      const initial = {
        height: 1,
        width: 380,
        x: area.x + 19,
        y: area.y + Math.floor(area.height / 2),
      };

      const f = nativePlacement(initial);
      f.window.showInactive();
      f.calls.length = 0;

      const nextHeight = Math.min(height, area.height);
      resizePromptWindow(f.window, nextHeight, area);
      const resized = f.window.getBounds();
      expect(resized.x).toBe(initial.x);
      expect(resized.width).toBe(380);
      expect(resized.height).toBe(nextHeight);
      expect(resized.y).toBe(
        initial.y + nextHeight > area.y + area.height
          ? area.y + area.height - nextHeight
          : initial.y
      );
      expect(f.calls).not.toContain("showInactive");
      const positionCount = f.positions.length;
      resizePromptWindow(f.window, 1, area);
      expect(f.window.getBounds().y).toBe(resized.y);
      expect(f.positions).toHaveLength(positionCount);
    })
);
