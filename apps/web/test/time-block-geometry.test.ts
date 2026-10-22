import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  gridGeometry,
  hourHeight,
  initialScroll,
  minuteToY,
  rangePixels,
  visibleTicks,
  yToMinute,
} from "../src/layout/geometry.js";
import {
  activeTimeBlocks,
  mergeHiddenRanges,
  TimeBlockPreferences,
} from "../src/layout/time-blocks.js";

const minute = Schema.Int.check(
  Schema.isBetween({ maximum: 1439, minimum: 0 })
);

const sourceRange = Schema.Struct({
  duration: Schema.Int.check(Schema.isBetween({ maximum: 1440, minimum: 1 })),
  hidden: Schema.Boolean,
  start: minute,
});

const maskRuns = (mask: readonly boolean[]) => {
  const runs: { start: number; end: number }[] = [];
  let start: number | undefined;

  for (let at = 0; at <= 1440; at += 1) {
    if (mask[at] === true && start === undefined) {
      start = at;
    }

    if (mask[at] !== true && start !== undefined) {
      runs.push({ end: at, start });
      start = undefined;
    }
  }

  return runs;
};

const oracleY = (
  runs: readonly { start: number; end: number }[],
  scale: number,
  at: number
): number => {
  let hidden = 0;
  let compressed = 0;

  for (const run of runs) {
    const overlap = Math.max(0, Math.min(at, run.end) - run.start);
    hidden += overlap;
    compressed += (overlap * 24) / (run.end - run.start);
  }

  return ((at - hidden) * scale) / 60 + compressed;
};

it.effect.prop(
  "named hidden ranges use their union, one strip per component and a strictly monotone reversible pixel map",
  {
    enabled: Schema.Boolean,
    fraction: Schema.Int.check(Schema.isBetween({ maximum: 59, minimum: 0 })),
    probe: minute,
    ranges: Schema.Array(sourceRange),
    zoom: Schema.Int.check(Schema.isBetween({ maximum: 20, minimum: -4 })),
  },
  ({ enabled, fraction, probe, ranges, zoom }) =>
    Effect.sync(() => {
      const blocks = ranges.map((range, id) => ({
        color: "#7d8d85",
        hidden: range.hidden,
        id,
        name: `Block ${id}`,
        ranges: [
          {
            endMinute: Math.min(1440, range.start + range.duration),
            startMinute: range.start,
          },
        ],
      }));

      const preferences = TimeBlockPreferences.make({ blocks, enabled });

      const mask = Array.from(
        { length: 1440 },
        (_, at) =>
          enabled &&
          ranges.some(
            (range) =>
              range.hidden &&
              at >= range.start &&
              at < Math.min(1440, range.start + range.duration)
          )
      );

      const runs = maskRuns(mask);
      const scale = 48 + zoom * 8;

      const grid = gridGeometry(
        scale,
        mergeHiddenRanges(activeTimeBlocks(preferences))
      );

      const at = probe + fraction / 60;

      expect(grid.visibleMinutes).toBe(mask.filter((hidden) => !hidden).length);
      expect(grid.segments.filter((segment) => segment.hidden)).toHaveLength(
        runs.length
      );
      expect(
        grid.segments
          .filter((segment) => segment.hidden)
          .every((segment) => segment.height === 24)
      ).toBe(true);
      expect(grid.height).toBeCloseTo(oracleY(runs, scale, 1440), 8);
      expect(minuteToY(grid, at)).toBeCloseTo(oracleY(runs, scale, at), 8);
      expect(yToMinute(grid, minuteToY(grid, at))).toBeCloseTo(at, 8);
      expect(visibleTicks(grid)).toEqual(
        Array.from({ length: 24 }, (_, hour) => hour * 60).filter(
          (tick) => mask[tick] !== true
        )
      );

      let increasing = true;
      let previous = -1;

      for (let position = 0; position <= 1440; position += 1) {
        const top = minuteToY(grid, position);
        increasing &&= top > previous;
        previous = top;
      }

      expect(increasing).toBe(true);

      const end = Math.min(1440, at + 60);
      expect(rangePixels(grid, at, end).height).toBeCloseTo(
        oracleY(runs, scale, end) - oracleY(runs, scale, at),
        8
      );
    })
);

it.effect.prop(
  "with blocks off both maps equal the old linear functions for every minute, including viewport-driven scales",
  {
    ranges: Schema.Array(sourceRange),
    viewport: Schema.Int.check(
      Schema.isBetween({ maximum: 3000, minimum: 100 })
    ),
    zoom: Schema.Int.check(Schema.isBetween({ maximum: 20, minimum: -10 })),
  },
  ({ ranges, viewport, zoom }) =>
    Effect.sync(() => {
      const preferences = TimeBlockPreferences.make({
        blocks: ranges.map((range, id) => ({
          color: "#7d8d85",
          hidden: range.hidden,
          id,
          name: `Disabled ${id}`,
          ranges: [
            {
              endMinute: Math.min(1440, range.start + range.duration),
              startMinute: range.start,
            },
          ],
        })),
        enabled: false,
      });

      const scale = hourHeight(zoom, viewport);

      const grid = gridGeometry(
        scale,
        mergeHiddenRanges(activeTimeBlocks(preferences))
      );

      expect(scale).toBe(
        Math.max(16, (viewport - 28 - 25) / 24, Math.min(208, 48 + zoom * 8))
      );
      let equal = grid.height === 24 * scale;

      for (let at = 0; at <= 1440; at += 1) {
        const oldY = (at * scale) / 60;
        equal &&=
          minuteToY(grid, at) === oldY &&
          yToMinute(grid, oldY) === Math.min(1440, (oldY * 60) / scale);
      }

      expect(equal).toBe(true);
    })
);

it.effect(
  "touching hidden blocks merge, full-day hiding stays finite and disabled blocks preserve ordinary geometry",
  () =>
    Effect.sync(() => {
      const grid = gridGeometry(48, [
        { endMinute: 720, startMinute: 600 },
        { endMinute: 840, startMinute: 660 },
        { endMinute: 900, startMinute: 840 },
      ]);

      expect(grid.hidden).toEqual([{ endMinute: 900, startMinute: 600 }]);
      expect(minuteToY(grid, 600)).toBe(480);
      expect(minuteToY(grid, 750)).toBe(492);
      expect(minuteToY(grid, 900)).toBe(504);
      expect(rangePixels(grid, 570, 930)).toEqual({ height: 72, top: 456 });
      expect(yToMinute(grid, 492)).toBe(750);
      expect(initialScroll(750, 48, 300, grid)).toBe(392);
      expect(yToMinute(grid, -20)).toBe(0);
      expect(yToMinute(grid, 10_000)).toBe(1440);

      const full = gridGeometry(hourHeight(0, 960, 25, 0), [
        { endMinute: 1440, startMinute: 0 },
      ]);

      expect(full.height).toBe(24);
      expect(full.visibleMinutes).toBe(0);
      expect(visibleTicks(full)).toEqual([]);
      expect(yToMinute(full, 12)).toBe(720);
      expect(initialScroll(720, 48, 600, full)).toBe(0);
      expect(hourHeight(-100, 1013, 25, 720)).toBe(80);
      expect(gridGeometry(48).height).toBe(1152);
    })
);
