import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { monthCellAt } from "../src/layout/month-hit.js";

const bounded = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ maximum, minimum }));

it.effect.prop(
  "month hit testing distinguishes the week row at the same X coordinate in five- and seven-day grids",
  {
    column: bounded(0, 34),
    height: bounded(20, 240),
    hidden: Schema.Boolean,
    left: bounded(-200, 200),
    row: bounded(0, 17),
    top: bounded(-1000, 200),
    width: bounded(16, 160),
  },
  ({ hidden, row, column, width, height, left, top }) =>
    Effect.sync(() => {
      const weekdays = hidden ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6];
      const selected = column % weekdays.length;

      const cells = Array.from({ length: 18 }, (_, week) =>
        weekdays.map((day, index) => ({
          bottom: top + (week + 1) * height,
          day: 20_000 + week * 7 + day,
          left: left + index * width,
          right: left + (index + 1) * width,
          top: top + week * height,
        }))
      ).flat();

      const actual = monthCellAt(
        cells,
        left + (selected + 0.5) * width,
        top + (row + 0.5) * height
      );

      expect(Option.getOrThrow(actual)).toBe(
        20_000 + row * 7 + (weekdays[selected] ?? -1)
      );
    })
);

it.effect(
  "month hit testing has half-open cell boundaries and clamps an outside drag to the nearest available date",
  () =>
    Effect.sync(() => {
      const cells = [
        { bottom: 100, day: 10, left: 0, right: 100, top: 0 },
        { bottom: 100, day: 11, left: 100, right: 200, top: 0 },
        { bottom: 200, day: 17, left: 0, right: 100, top: 100 },
        { bottom: 200, day: 18, left: 100, right: 200, top: 100 },
      ];

      expect(Option.getOrThrow(monthCellAt(cells, 100, 100))).toBe(18);
      expect(Option.getOrThrow(monthCellAt(cells, -40, 150))).toBe(17);
      expect(Option.getOrThrow(monthCellAt(cells, 250, 250))).toBe(18);
      expect(Option.isNone(monthCellAt([], 100, 100))).toBe(true);
    })
);
