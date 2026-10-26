import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { initialTransition, transition } from "xstate";

import { gestureMachine } from "../src/client/editing/gesture-machine.js";
import {
  GesturePoint,
  GestureTarget,
} from "../src/client/editing/gesture-model.js";
import { dayFromIso, isoFromDay } from "../src/layout/navigation.js";
import { fixtureEvents } from "./fixture.js";

const point = (
  day: number,
  minute: number,
  at: number,
  mod: boolean,
  alt = false,
  shift = false,
  x = 0,
  y = 0
) =>
  GesturePoint.make({ alt, at, day, minute, mod, pointerId: 1, shift, x, y });

const clicks = (
  first: typeof GesturePoint.Type,
  second: typeof GesturePoint.Type,
  up = second,
  allDay = false
) => {
  let [snapshot] = initialTransition(gestureMachine);

  for (const [down, end] of [
    [first, first],
    [second, up],
  ] as const) {
    [snapshot] = transition(gestureMachine, snapshot, {
      start: { allDay, edge: "body", point: down, target: Option.none() },
      type: "DOWN",
    });
    [snapshot] = transition(gestureMachine, snapshot, {
      point: end,
      type: "UP",
    });
  }

  return snapshot;
};

const daySchema = Schema.Int.check(
  Schema.isBetween({
    maximum: dayFromIso("2040-12-30"),
    minimum: dayFromIso("2015-01-01"),
  })
);

const minuteSchema = Schema.Int.check(
  Schema.isBetween({ maximum: 1439, minimum: 0 })
);

it.effect.prop(
  "full-day Mod double-click keeps the completing hit date",
  { allDay: Schema.Boolean, day: daySchema, minute: minuteSchema },
  ({ allDay, day, minute }) =>
    Effect.sync(() => {
      const result = clicks(
        point(day, minute, 100, false),
        point(day, minute, 300, true),
        point(day, minute, 301, true),
        allDay
      ).context;

      expect(result.completed?.range).toEqual({
        allDay: true,
        endDate: isoFromDay(day),
        endTime: "00:00",
        startDate: isoFromDay(day),
        startTime: "00:00",
      });
      expect(result.completed?.allDayRow).toBe(allDay);
      expect(result.completed?.duplicate).toBe(false);
      expect(result.completed?.intent ?? "ordinary").toBe("ordinary");
      expect(result.completed?.id).toBe(1);
      expect(result.sequence).toBe(1);
      expect(result.blockClick).toBe(true);
    })
);

it.effect.prop(
  "full-day chooses only Mod without Alt or Shift on completing pointer-up",
  {
    alt: Schema.Boolean,
    firstMod: Schema.Boolean,
    mod: Schema.Boolean,
    shift: Schema.Boolean,
  },
  ({ alt, firstMod, mod, shift }) =>
    Effect.sync(() => {
      const day = dayFromIso("2026-10-22");

      const result = clicks(
        point(day, 540, 100, firstMod),
        point(day, 540, 300, !mod),
        point(day, 540, 301, mod, alt, shift)
      ).context;

      expect(result.completed?.range.allDay).toBe(mod && !alt && !shift);
      expect(result.sequence).toBe(1);
    })
);

it.effect.prop(
  "full-day double-click preserves timestamp and pixel boundaries",
  {
    delay: Schema.Int.check(Schema.isBetween({ maximum: 352, minimum: -1 })),
    x: Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 0 })),
    y: Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 0 })),
  },
  ({ delay, x, y }) =>
    Effect.sync(() => {
      const day = dayFromIso("2026-10-22");

      for (const [gap, dx, dy, allowed] of [
        [0, 0, 0, true],
        [350, 5, 5, true],
        [-1, 0, 0, false],
        [351, 0, 0, false],
        [350, 6, 0, false],
        [350, 0, 6, false],
      ] as const) {
        const corner = clicks(
          point(day, 540, 100, true),
          point(day, 540, 100 + gap, true, false, false, dx, dy)
        ).context;

        expect(corner.completed !== undefined).toBe(allowed);
      }

      const { context } = clicks(
        point(day, 540, 100, true),
        point(day, 540, 100 + delay, true, false, false, x, y)
      );

      const accepted = delay >= 0 && delay <= 350 && x <= 5 && y <= 5;
      expect(context.completed !== undefined).toBe(accepted);
      expect(context.sequence).toBe(accepted ? 1 : 0);

      if (accepted) {
        expect(context.completed?.range.allDay).toBe(true);
      }
    })
);

it.effect(
  "full-day late-night and DST dates never become the snapped following date",
  () =>
    Effect.sync(() => {
      for (const date of ["2026-03-08", "2026-11-01", "2026-10-23"]) {
        const day = dayFromIso(date);

        for (const minute of [1433, 1435, 1439]) {
          const result = clicks(
            point(day, minute, 100, true),
            point(day, minute, 300, true)
          ).context.completed;

          expect(result?.range).toEqual({
            allDay: true,
            endDate: date,
            endTime: "00:00",
            startDate: date,
            startTime: "00:00",
          });
        }
      }
    })
);

it.effect.prop(
  "event targets never borrow empty-grid full-day history",
  { alt: Schema.Boolean, mod: Schema.Boolean },
  ({ alt, mod }) =>
    Effect.gen(function* eventTargetHistory() {
      const event = yield* Effect.fromNullishOr(fixtureEvents[0]);
      yield* Effect.sync(() => {
        const day = dayFromIso("2026-10-19");

        const target = GestureTarget.make({
          allDay: false,
          editable: true,
          end: day * 1440 + 600,
          event,
          key: "work/primary/a-review",
          start: day * 1440 + 540,
        });

        for (const edge of ["body", "start", "end"] as const) {
          let [snapshot] = initialTransition(gestureMachine);
          const first = point(day, 540, 100, mod, alt);
          [snapshot] = transition(gestureMachine, snapshot, {
            start: {
              allDay: false,
              edge: "body",
              point: first,
              target: Option.none(),
            },
            type: "DOWN",
          });
          [snapshot] = transition(gestureMachine, snapshot, {
            point: first,
            type: "UP",
          });
          const second = point(day, 540, 300, mod, alt);
          [snapshot] = transition(gestureMachine, snapshot, {
            start: {
              allDay: false,
              edge,
              point: second,
              target: Option.some(target),
            },
            type: "DOWN",
          });
          [snapshot] = transition(gestureMachine, snapshot, {
            point: second,
            type: "UP",
          });
          expect(snapshot.context.completed).toBeUndefined();
          expect(snapshot.context.sequence).toBe(0);
        }
      });
    })
);
