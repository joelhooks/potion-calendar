import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Schema } from "effect";

import {
  creationPosition,
  doubleClick,
  dragDateRange,
  dragPrecision,
  dragTimeRange,
  resizeTimeRange,
} from "../src/layout/edit-time.js";
import { dayFromIso } from "../src/layout/navigation.js";

const minute = Schema.Int.check(
  Schema.isBetween({ maximum: 2880, minimum: 0 })
);

const precision = Schema.Literals([5, 15, 60]);

const day = dayFromIso("2026-10-19");

const midnight = DateTime.toEpochMillis(
  DateTime.makeUnsafe("2026-10-19T00:00:00Z")
);

it.effect.prop(
  "C uses the intended date and never rounds the current clock backwards, including milliseconds",
  {
    flashed: Schema.Boolean,
    millisecond: Schema.Int.check(
      Schema.isBetween({ maximum: 999, minimum: 0 })
    ),
    minute: Schema.Int.check(Schema.isBetween({ maximum: 1439, minimum: 0 })),
    second: Schema.Int.check(Schema.isBetween({ maximum: 59, minimum: 0 })),
    todayVisible: Schema.Boolean,
  },
  ({ flashed, minute: clockMinute, millisecond, second, todayVisible }) =>
    Effect.sync(() => {
      const elapsed = clockMinute * 60_000 + second * 1000 + millisecond;

      const visible = todayVisible
        ? [day - 1, day, day + 1]
        : [day - 7, day - 6];

      const flashedDay = flashed ? day + 3 : undefined;
      let intendedDay = day - 7;

      if (todayVisible) {
        intendedDay = day;
      }

      if (flashed) {
        intendedDay = day + 3;
      }

      const result = creationPosition(
        midnight + elapsed,
        "UTC",
        visible,
        flashedDay
      );

      const rounded =
        ((result.day - intendedDay) * 1440 + result.minute) * 60_000;

      expect(rounded).toBeGreaterThanOrEqual(elapsed);
      expect(rounded - elapsed).toBeLessThan(30 * 60_000);
      expect(result.minute % 30).toBe(0);
      expect(result.minute).toBeGreaterThanOrEqual(0);
      expect(result.minute).toBeLessThan(1440);
    })
);

it.effect.prop(
  "drag direction does not change a snapped selection and all-day ends stay exclusive",
  { anchor: minute, pointer: minute, precision },
  ({ anchor, pointer, precision: step }) =>
    Effect.sync(() => {
      const forward = dragTimeRange(anchor, pointer, step);
      expect(forward).toEqual(dragTimeRange(pointer, anchor, step));
      expect(forward.start % step).toBe(0);
      expect(forward.end % step).toBe(0);
      expect(forward.end - forward.start).toBeGreaterThanOrEqual(step);
      expect(forward.start).toBeGreaterThanOrEqual(
        Math.min(anchor, pointer) - step / 2
      );
      expect(forward.start).toBeLessThanOrEqual(
        Math.min(anchor, pointer) + step / 2
      );
      expect(forward.end).toBeGreaterThanOrEqual(
        Math.max(anchor, pointer) - step / 2
      );
      const dates = dragDateRange(anchor, pointer);
      expect(dates.start).toBeLessThanOrEqual(anchor);
      expect(dates.start).toBeLessThanOrEqual(pointer);
      expect(dates.end).toBeGreaterThan(anchor);
      expect(dates.end).toBeGreaterThan(pointer);
      expect(dates.end - dates.start).toBe(Math.abs(anchor - pointer) + 1);
    })
);

it.effect.prop(
  "resizing clamps at one precision interval without moving the opposite edge",
  {
    duration: Schema.Int.check(Schema.isBetween({ maximum: 240, minimum: 1 })),
    pointer: minute,
    precision,
    start: minute,
  },
  ({ start, duration, pointer, precision: step }) =>
    Effect.sync(() => {
      const original = { end: start + duration, start };
      const north = resizeTimeRange(original, "start", pointer, step);
      const south = resizeTimeRange(original, "end", pointer, step);
      expect(north.end).toBe(original.end);
      expect(south.start).toBe(original.start);
      expect(north.end - north.start).toBeGreaterThanOrEqual(step);
      expect(south.end - south.start).toBeGreaterThanOrEqual(step);
    })
);

it.effect.prop(
  "double-click detection uses both spatial axes and the 350 millisecond window",
  {
    delta: Schema.Int.check(Schema.isBetween({ maximum: 400, minimum: -1 })),
    x: Schema.Int.check(Schema.isBetween({ maximum: 10, minimum: -10 })),
    y: Schema.Int.check(Schema.isBetween({ maximum: 10, minimum: -10 })),
  },
  ({ delta, x, y }) =>
    Effect.sync(() => {
      expect(
        doubleClick(
          { at: 1000, x: 40, y: 50 },
          { at: 1000 + delta, x: 40 + x, y: 50 + y }
        )
      ).toBe(
        delta >= 0 && delta <= 350 && Math.abs(x) <= 5 && Math.abs(y) <= 5
      );
    })
);

it.effect(
  "modifier precision is explicit and creation rounding crosses midnight instead of wrapping backwards",
  () =>
    Effect.sync(() => {
      expect(dragPrecision({ alt: false, shift: false })).toBe(15);
      expect(dragPrecision({ alt: true, shift: false })).toBe(5);
      expect(dragPrecision({ alt: false, shift: true })).toBe(60);
      expect(dragPrecision({ alt: true, shift: true })).toBe(60);
      expect(
        creationPosition(
          DateTime.toEpochMillis(
            DateTime.makeUnsafe("2026-10-19T09:30:00.000-07:00")
          ),
          "America/Los_Angeles",
          [day]
        )
      ).toEqual({ day, minute: 570 });
      expect(
        creationPosition(
          DateTime.toEpochMillis(
            DateTime.makeUnsafe("2026-10-19T09:30:00.001-07:00")
          ),
          "America/Los_Angeles",
          [day]
        )
      ).toEqual({ day, minute: 600 });
      expect(
        creationPosition(
          DateTime.toEpochMillis(
            DateTime.makeUnsafe("2026-10-19T23:59:59.999-07:00")
          ),
          "America/Los_Angeles",
          [day]
        )
      ).toEqual({ day: day + 1, minute: 0 });
      expect(doubleClick({ at: 0, x: 0, y: 0 }, { at: 350, x: 5, y: -5 })).toBe(
        true
      );
      expect(doubleClick({ at: 0, x: 0, y: 0 }, { at: 351, x: 0, y: 0 })).toBe(
        false
      );
    })
);
