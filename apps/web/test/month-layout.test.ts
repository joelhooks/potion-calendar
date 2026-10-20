import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { monthWeekLayout } from "../src/layout/month-week.js";
import { monthGeometry, monthWeeks } from "../src/layout/month.js";
import {
  dayFromIso,
  initialNavigation,
  partsFromDay,
} from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { fixtureModel } from "./fixture.js";

const bounded = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ maximum, minimum }));

it.effect.prop(
  "month rows preserve weekday columns and leave bounded-date placeholders instead of shifting dates",
  {
    hidden: Schema.Boolean,
    month: bounded(1, 12),
    startsOn: bounded(0, 6),
    year: bounded(2015, 2040),
  },
  ({ year, month, startsOn, hidden }) =>
    Effect.sync(() => {
      const anchor = dayFromIso(`${year}-${String(month).padStart(2, "0")}-01`);

      const weeks = monthWeeks({
        ...initialNavigation(anchor),
        hideWeekends: hidden,
        mode: "month",
        weekStartsOn: startsOn,
      });

      expect(weeks).toHaveLength(6);

      for (const [index, week] of weeks.entries()) {
        expect(partsFromDay(week.start).weekDay).toBe(startsOn);
        expect(week.start).toBe((weeks[0]?.start ?? 0) + index * 7);
        expect(week.days).toHaveLength(hidden ? 5 : 7);

        for (const cell of week.days) {
          const parts = partsFromDay(cell.day);
          expect(cell.enabled).toBe(parts.year >= 2015 && parts.year <= 2040);

          if (hidden) {
            expect([0, 6]).not.toContain(parts.weekDay);
          }
        }
      }

      expect(
        new Set(weeks.flatMap((week) => week.days.map((cell) => cell.day))).size
      ).toBe(hidden ? 30 : 42);
    })
);

it.effect.prop(
  "chip capacity fits complete 21px rows after the header and date allowances, never a clipped extra row",
  { gutter: Schema.Boolean, height: bounded(0, 3000) },
  ({ height, gutter }) =>
    Effect.sync(() => {
      const geometry = monthGeometry(height, gutter);
      expect(geometry.columnsPrefix).toBe(gutter ? "24px " : "");
      const usable = Math.max(0, (height - 29) / 6 - 32);
      expect(geometry.chipRows * 21).toBeLessThanOrEqual(usable);
      expect((geometry.chipRows + 1) * 21).toBeGreaterThan(usable);
    })
);

it.effect.prop(
  "overflow reserves the final row and conserves every event even when the viewport has no chip capacity",
  { capacity: bounded(0, 10), count: bounded(0, 30) },
  ({ count, capacity }) =>
    Effect.sync(() => {
      const [source] = visibleEvents(fixtureModel());

      if (source === undefined) {
        throw new Error("Missing real fixture event");
      }

      const events = Array.from({ length: count }, (_, index) => ({
        ...source,
        allDay: false,
        endDay: source.startDay + 1,
        key: `item-${index}`,
        startDay: source.startDay,
        startMinute: index,
      })).toReversed();

      const [result, next] = monthWeekLayout(
        events,
        [
          { day: source.startDay, enabled: true },
          { day: source.startDay + 1, enabled: true },
        ],
        capacity
      ).cells;

      if (result === undefined || next === undefined) {
        throw new Error("Missing month cells");
      }

      expect(result.displayed.length + result.overflow).toBe(count);
      expect(result.displayed.map((item) => item.startMinute)).toEqual(
        Array.from({ length: result.displayed.length }, (_, index) => index)
      );

      if (count <= capacity) {
        expect(result.overflow).toBe(0);
      }

      if (count > capacity && capacity > 0) {
        expect(result.displayed).toHaveLength(capacity - 1);
      }

      if (capacity === 0) {
        expect(result.displayed).toHaveLength(0);
      }

      expect(next.overflow).toBe(0);
      expect(next.displayed).toHaveLength(0);
    })
);
