import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { initialTransition, transition } from "xstate";

import { promptSwipe } from "../src/client/prompt-swipe.js";

const gesture = (width: number, dx: number, dy: number, elapsed: number) => {
  const [initial] = initialTransition(promptSwipe);

  const [tracking] = transition(promptSwipe, initial, {
    at: 0,
    pointer: 1,
    type: "Start",
    width,
    x: 0,
    y: 0,
  });

  const [moving] = transition(promptSwipe, tracking, {
    at: elapsed / 2,
    pointer: 1,
    type: "Move",
    x: dx,
    y: dy,
  });

  return transition(promptSwipe, moving, {
    at: elapsed,
    pointer: 1,
    type: "End",
    x: dx,
    y: dy,
  })[0];
};

it.effect.prop(
  "slow rightward drags dismiss only past forty percent, while leftward drags never dismiss",
  {
    percent: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: -100 }))
    ),
    width: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 1200, minimum: 100 }))
    ),
  },
  ({ percent, width }) =>
    Effect.sync(() => {
      const result = gesture(width, (width * percent) / 100, 0, 2000);
      expect(result.matches("dismissed")).toBe(percent > 40);
    })
);

it.effect.prop(
  "a vertical scroll gesture cannot become a dismissing flick",
  {
    dx: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 500, minimum: 16 }))
    ),
  },
  ({ dx }) =>
    Effect.sync(() => {
      expect(gesture(380, dx, dx + 1, 10).matches("dismissed")).toBe(false);
    })
);

it.effect.each([
  { dismiss: true, distance: 16, elapsed: 20, width: 380 },
  { dismiss: false, distance: 15, elapsed: 1, width: 380 },
  { dismiss: false, distance: 16, elapsed: 1000, width: 380 },
  { dismiss: false, distance: 160, elapsed: 1000, width: 400 },
  { dismiss: true, distance: 161, elapsed: 1000, width: 400 },
  { dismiss: false, distance: -200, elapsed: 10, width: 380 },
  { dismiss: false, distance: 500, elapsed: 10, width: 0 },
  { dismiss: false, distance: 16, elapsed: 0, width: 380 },
])(
  "flick and distance boundaries: %j",
  ({ dismiss, distance, elapsed, width }) =>
    Effect.sync(() => {
      expect(gesture(width, distance, 0, elapsed).matches("dismissed")).toBe(
        dismiss
      );
    })
);

it.effect(
  "cancel and foreign pointers cannot dismiss, and settled drags consume a click",
  () =>
    Effect.sync(() => {
      const [initial] = initialTransition(promptSwipe);

      const [tracking] = transition(promptSwipe, initial, {
        at: 0,
        pointer: 1,
        type: "Start",
        width: 380,
        x: 0,
        y: 0,
      });

      const [foreign] = transition(promptSwipe, tracking, {
        at: 1,
        pointer: 2,
        type: "End",
        x: 500,
        y: 0,
      });

      expect(foreign.matches("tracking")).toBe(true);

      const [dragging] = transition(promptSwipe, foreign, {
        at: 1000,
        pointer: 1,
        type: "Move",
        x: 100,
        y: 0,
      });

      expect(dragging.matches("dragging")).toBe(true);

      const [cancelled] = transition(promptSwipe, dragging, {
        pointer: 1,
        type: "Cancel",
      });

      expect(cancelled.matches("settled")).toBe(true);
      const [clicked] = transition(promptSwipe, cancelled, { type: "Click" });
      expect(clicked.matches("idle")).toBe(true);
    })
);
