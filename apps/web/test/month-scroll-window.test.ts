import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  initialMonthPosition,
  MonthRebase,
  monthWindowRange,
  monthWindowWeeks,
  rebaseMonth,
} from "../src/layout/month-window.js";

const bounded = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ maximum, minimum }));

it.effect.prop(
  "rebasing preserves the date under every pointer position and a visible keyboard focus while keeping exactly three viewports",
  {
    first: bounded(17_000, 25_000),
    offset: bounded(0, 12_000),
    pointer: bounded(0, 6000),
    rowHeight: bounded(20, 400),
  },
  ({ first, rowHeight, offset, pointer }) =>
    Effect.sync(() => {
      const position = {
        firstWeek: first,
        scrollTop: (rowHeight * offset) / 1000,
      };

      const focusedDay = first + Math.floor(offset / 1000) * 7 + 2;
      const result = rebaseMonth(position, rowHeight, focusedDay);
      expect(result._tag).not.toBe("Held");
      const y = (rowHeight * pointer) / 1000;
      const before = first + ((position.scrollTop + y) / rowHeight) * 7;

      const after =
        result.position.firstWeek +
        ((result.position.scrollTop + y) / rowHeight) * 7;

      expect(after).toBeCloseTo(before, 8);
      const coverage = monthWindowRange(result.position.firstWeek);
      expect(coverage.end - coverage.start).toBe(18 * 7);
      expect(monthWindowWeeks).toBe(18);
      expect(focusedDay).toBeGreaterThanOrEqual(coverage.start);
      expect(focusedDay).toBeLessThan(coverage.end);

      if (MonthRebase.guards.Rebased(result)) {
        expect(result.position.scrollTop / rowHeight).toBeGreaterThanOrEqual(6);
        expect(result.position.scrollTop / rowHeight).toBeLessThan(7);
        expect(rebaseMonth(result.position, rowHeight, focusedDay)._tag).toBe(
          "Unchanged"
        );
      }
    })
);

it.effect.prop(
  "a rebase that would evict a keyboard focus is held rather than silently moving or dropping focus",
  {
    first: bounded(17_000, 25_000),
    forward: Schema.Boolean,
    rowHeight: bounded(20, 400),
  },
  ({ first, rowHeight, forward }) =>
    Effect.sync(() => {
      const position = {
        firstWeek: first,
        scrollTop: forward ? rowHeight * 12 : 0,
      };

      const focusedDay = forward ? first : first + 18 * 7 - 1;
      const result = rebaseMonth(position, rowHeight, focusedDay);
      expect(result).toEqual(MonthRebase.cases.Held.make({ position }));
      expect(rebaseMonth(position, rowHeight)._tag).toBe("Rebased");
    })
);

it.effect.prop(
  "initial positioning leaves a full six-week buffer on both sides of the visible six weeks",
  { rowHeight: bounded(20, 400), week: bounded(17_000, 25_000) },
  ({ week, rowHeight }) =>
    Effect.sync(() => {
      const position = initialMonthPosition(week, rowHeight);
      expect(position.firstWeek + (position.scrollTop / rowHeight) * 7).toBe(
        week
      );
      expect(monthWindowRange(position.firstWeek)).toEqual({
        end: week + 84,
        start: week - 42,
      });
      expect(rebaseMonth(position, rowHeight)._tag).toBe("Unchanged");
    })
);
