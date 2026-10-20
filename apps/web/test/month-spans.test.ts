import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { monthWeekLayout } from "../src/layout/month-week.js";
import { monthWeeks } from "../src/layout/month.js";
import { dayFromIso, initialNavigation } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { fixtureModel } from "./fixture.js";

const bounded = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ maximum, minimum }));

it.effect.prop(
  "one multi-day event yields one bar per touched week, including hidden-weekend and month-boundary continuations",
  {
    duration: bounded(1, 18),
    hidden: Schema.Boolean,
    offset: bounded(0, 25),
    startsOn: bounded(0, 6),
  },
  ({ hidden, startsOn, duration, offset }) =>
    Effect.sync(() => {
      const [source] = visibleEvents(fixtureModel());

      if (source === undefined) {
        throw new Error("Missing event fixture");
      }

      const start = dayFromIso("2026-10-01") + offset;

      const item = {
        ...source,
        allDay: true,
        endDay: start + duration,
        endMinute: 0,
        key: "span",
        startDay: start,
        startMinute: 0,
      };

      const weeks = monthWeeks({
        ...initialNavigation(start),
        anchor: dayFromIso("2026-10-01"),
        hideWeekends: hidden,
        mode: "month",
        weekStartsOn: startsOn,
      });

      for (const week of weeks) {
        const covered = week.days.flatMap(({ day, enabled }, column) =>
          enabled && start <= day && day < start + duration ? [column] : []
        );

        const result = monthWeekLayout([item], week.days, 4);
        expect(result.bars).toHaveLength(covered.length > 0 ? 1 : 0);
        const [bar] = result.bars;

        if (bar !== undefined) {
          expect([bar.start, bar.end, bar.row]).toEqual([
            covered[0],
            (covered.at(-1) ?? -1) + 1,
            0,
          ]);
        }

        for (const cell of result.cells) {
          expect(cell.displayed).toHaveLength(0);
          expect(cell.overflow).toBe(0);
        }
      }
    })
);

it.effect.prop(
  "each date conserves visible bars, timed items and hidden counts without overlapping or occupying its overflow slot",
  {
    allDay: bounded(0, 9),
    capacity: bounded(0, 8),
    hidden: Schema.Boolean,
    timed: bounded(0, 9),
  },
  ({ allDay, timed, capacity, hidden }) =>
    Effect.sync(() => {
      const [source] = visibleEvents(fixtureModel());

      if (source === undefined) {
        throw new Error("Missing event fixture");
      }

      const start = dayFromIso("2026-10-18");

      const days = Array.from({ length: 7 }, (_, index) => ({
        day: start + index,
        enabled: !hidden || (index > 0 && index < 6),
      }));

      const horizontal = Array.from({ length: allDay }, (_, index) => ({
        ...source,
        allDay: true,
        endDay: start + 4 + (index % 3),
        endMinute: 0,
        key: `bar-${index}`,
        startDay: start + (index % 4),
        startMinute: 0,
      }));

      const vertical = Array.from({ length: timed }, (_, index) => ({
        ...source,
        allDay: false,
        endDay: start + (index % 7) + 1,
        endMinute: index + 30,
        key: `timed-${index}`,
        startDay: start + (index % 7),
        startMinute: index,
      }));

      const events = [...vertical, ...horizontal].toReversed();
      const result = monthWeekLayout(events, days, capacity);

      for (const [column, cell] of result.cells.entries()) {
        const expected = cell.enabled
          ? events.filter(
              (item) => item.startDay <= cell.day && cell.day < item.endDay
            ).length
          : 0;

        const bars = result.bars.filter(
          (bar) => bar.start <= column && column < bar.end
        );

        const rows = [
          ...bars.map((bar) => bar.row),
          ...cell.displayed.map((_, index) => cell.startRow + index),
        ];

        expect(bars.length + cell.displayed.length + cell.overflow).toBe(
          expected
        );
        expect(new Set(rows).size).toBe(rows.length);
        expect(
          rows.every(
            (row) => row >= 0 && row < capacity - Number(cell.overflow > 0)
          )
        ).toBe(true);
      }
    })
);

it.effect(
  "month packing orders by original start and longer duration even when clipped spans begin in the same column",
  () =>
    Effect.sync(() => {
      const [source] = visibleEvents(fixtureModel());

      if (source === undefined) {
        throw new Error("Missing event fixture");
      }

      const start = dayFromIso("2026-10-18");

      const days = Array.from({ length: 7 }, (_, index) => ({
        day: start + index,
        enabled: true,
      }));

      const earlier = {
        ...source,
        allDay: true,
        endDay: start + 2,
        key: "earlier",
        startDay: start - 7,
      };

      const longer = {
        ...source,
        allDay: true,
        endDay: start + 6,
        key: "longer",
        startDay: start,
      };

      const shorter = {
        ...source,
        allDay: true,
        endDay: start + 4,
        key: "shorter",
        startDay: start,
      };

      expect(
        monthWeekLayout([shorter, longer, earlier], days, 5).bars.map((bar) => [
          bar.item.key,
          bar.row,
        ])
      ).toEqual([
        ["earlier", 0],
        ["longer", 1],
        ["shorter", 2],
      ]);
    })
);
