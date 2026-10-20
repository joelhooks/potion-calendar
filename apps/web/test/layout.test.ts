import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  allDayCounts,
  allDayHeight,
  packAllDay,
} from "../src/layout/all-day.js";
import { collides, layoutTimed } from "../src/layout/overlap.js";

it.effect("same-start cards use the observed 75% / 50% overlap", () =>
  Effect.sync(() => {
    expect(
      layoutTimed([
        { end: 600, id: "a", start: 540 },
        { end: 600, id: "b", start: 540 },
      ])
    ).toEqual([
      { id: "a", lane: 0, lanes: 2, left: 0, paint: 0, width: 0.75 },
      { id: "b", lane: 1, lanes: 2, left: 0.5, paint: 1, width: 0.5 },
    ]);
  })
);

it.effect(
  "endpoint touches are independent and zero-duration lasts one second",
  () =>
    Effect.sync(() => {
      expect(
        layoutTimed([
          { end: 600, id: "a", start: 540 },
          { end: 660, id: "b", start: 600 },
        ]).map((item) => item.width)
      ).toEqual([1, 1]);
      expect(
        collides({ end: 1, id: "a", start: 1 }, { end: 2, id: "b", start: 1 })
      ).toBe(true);
      expect(
        collides(
          { end: 1, id: "a", start: 1 },
          { end: 2, id: "b", start: 1 + 1 / 60 }
        )
      ).toBe(false);
    })
);

it.effect("a late card reaches back leaving five percentage points", () =>
  Effect.sync(() => {
    const placed = layoutTimed([
      { end: 720, id: "a", start: 540 },
      { end: 630, id: "b", start: 571 },
    ]);

    expect(placed[0]?.width).toBe(1);
    expect(placed[1]?.left).toBe(0.05);
    expect(placed[1]?.width).toBe(0.95);

    const boundary = layoutTimed([
      { end: 720, id: "a", start: 540 },
      { end: 630, id: "b", start: 570 },
    ]);

    expect(boundary[0]?.width).toBe(0.75);
    expect(boundary[1]?.left).toBe(0.5);
  })
);

it.effect.prop(
  "generated overlaps retain every card, separate lane conflicts and stay inside the column",
  {
    intervals: Schema.Array(
      Schema.Struct({ duration: Schema.Int, start: Schema.Int })
    ),
  },
  ({ intervals }) =>
    Effect.sync(() => {
      const events = intervals.slice(0, 40).map((item, index) => {
        const start = Math.abs(item.start % 1440);

        return {
          end: start + Math.abs(item.duration % 240),
          id: String(index),
          start,
        };
      });

      const placed = layoutTimed(events);
      expect(placed).toHaveLength(events.length);
      expect(layoutTimed(events.toReversed())).toEqual(placed);

      for (const item of placed) {
        expect(item.left).toBeGreaterThanOrEqual(0);
        expect(item.width).toBeGreaterThan(0);
        expect(item.left + item.width).toBeLessThanOrEqual(1.00000001);
        const event = events.find((candidate) => candidate.id === item.id);

        for (const other of placed) {
          const otherEvent = events.find(
            (candidate) => candidate.id === other.id
          );

          if (
            event &&
            otherEvent &&
            item.id !== other.id &&
            collides(event, otherEvent)
          ) {
            expect(item.lane).not.toBe(other.lane);
          }
        }
      }
    })
);

it.effect.prop(
  "all-day packing never hides a colliding chip and is independent of input order",
  {
    spans: Schema.Array(
      Schema.Struct({ length: Schema.Int, start: Schema.Int })
    ),
  },
  ({ spans }) =>
    Effect.sync(() => {
      const events = spans.slice(0, 40).map((span, index) => {
        const start = Math.abs(span.start % 31);

        return {
          end: start + 1 + Math.abs(span.length % 14),
          id: String(index),
          start,
        };
      });

      const packed = packAllDay(events);
      expect(packed).toHaveLength(events.length);
      expect(packAllDay(events.toReversed())).toEqual(packed);
      expect(
        packAllDay(events, new Map(packed.map((item) => [item.id, item.row])))
      ).toEqual(packed);

      for (const item of packed) {
        for (const other of packed) {
          if (
            item.id !== other.id &&
            item.start < other.end &&
            other.start < item.end
          ) {
            expect(item.row).not.toBe(other.row);
          }
        }
      }
    })
);

it.effect("all-day row geometry and collapsed counts use exclusive ends", () =>
  Effect.sync(() => {
    expect(allDayHeight(0, false, true)).toBe(25);
    expect(allDayHeight(2, false, true)).toBe(46);
    expect(allDayHeight(20, false, true)).toBe(137.5);
    expect(allDayHeight(3, true, false)).toBe(25);
    expect(allDayCounts([{ end: 3, id: "a", start: 1 }], [1, 2, 3])).toEqual([
      1, 1, 0,
    ]);
  })
);
