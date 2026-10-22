import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { initialTransition, transition } from "xstate";

import { gestureMachine } from "../src/client/editing/gesture-machine.js";
import { GesturePoint } from "../src/client/editing/gesture-model.js";
import { dayFromIso } from "../src/layout/navigation.js";

const day = dayFromIso("2026-10-22");

const sample = (minute: number, at: number, alt: boolean, offset = 0) =>
  GesturePoint.make({
    alt,
    at,
    day,
    minute,
    pointerId: 1,
    shift: false,
    x: offset,
    y: offset,
  });

const createFromClicks = (
  minute: number,
  alt: boolean,
  delay: number,
  offset: number
) => {
  let [snapshot] = initialTransition(gestureMachine);

  for (const [index, point] of [
    sample(minute, 100, alt),
    sample(minute, 100 + delay, alt, offset),
  ].entries()) {
    [snapshot] = transition(gestureMachine, snapshot, {
      start: { allDay: false, edge: "body", point, target: Option.none() },
      type: "DOWN",
    });
    [snapshot] = transition(gestureMachine, snapshot, { point, type: "UP" });

    if (index === 0) {
      expect(snapshot.context.completed).toBeUndefined();
      expect(snapshot.context.sequence).toBe(0);
    }
  }

  return snapshot;
};

const absoluteMinute = (date: string, time: string) =>
  dayFromIso(date) * 1440 +
  Number(time.slice(0, 2)) * 60 +
  Number(time.slice(3));

it.effect.prop(
  "Alt double-click creates one five-minute interval, plain double-click keeps thirty minutes, and single clicks never create",
  {
    alt: Schema.Boolean,
    minute: Schema.Int.check(Schema.isBetween({ maximum: 1439, minimum: 0 })),
  },
  ({ alt, minute }) =>
    Effect.sync(() => {
      const snapshot = createFromClicks(minute, alt, 200, 0);
      const result = snapshot.context.completed;
      expect(result).toBeDefined();

      if (result === undefined) {
        return;
      }

      const from = absoluteMinute(
        result.range.startDate,
        result.range.startTime
      );

      const to = absoluteMinute(result.range.endDate, result.range.endTime);
      const precision = alt ? 5 : 15;
      expect(to - from).toBe(alt ? 5 : 30);
      expect(from).toBe(
        day * 1440 + Math.round(minute / precision) * precision
      );
      expect(result.range.allDay).toBe(false);
      expect(snapshot.context.sequence).toBe(1);
      expect(snapshot.context.blockClick).toBe(true);
    })
);

it.effect(
  "Alt creation accepts the exact double-click corner and rejects either exceeded tolerance",
  () =>
    Effect.sync(() => {
      for (const [delay, offset, accepted] of [
        [350, 5, true],
        [351, 5, false],
        [350, 6, false],
      ] as const) {
        expect(
          createFromClicks(540, true, delay, offset).context.completed !==
            undefined
        ).toBe(accepted);
      }
    })
);

it.effect.prop(
  "Alt creation keeps the inclusive 350ms and 5px double-click boundaries",
  {
    delay: Schema.Int.check(Schema.isBetween({ maximum: 351, minimum: 0 })),
    offset: Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 0 })),
  },
  ({ delay, offset }) =>
    Effect.sync(() => {
      const snapshot = createFromClicks(540, true, delay, offset);
      expect(snapshot.context.completed !== undefined).toBe(
        delay <= 350 && offset <= 5
      );
      expect(snapshot.context.sequence).toBe(
        delay <= 350 && offset <= 5 ? 1 : 0
      );
    })
);
