import { setupEffect } from "@xstate/effect";
import { Schema } from "effect";
import { types } from "xstate";

import { SelectionPoint } from "../../layout/selection-set.js";

interface RectangleContext {
  readonly origin: typeof SelectionPoint.Type | undefined;
  readonly point: typeof SelectionPoint.Type | undefined;
  readonly pointerId: number | undefined;
  readonly revision: number;
  readonly click:
    | { readonly key: string; readonly mod: boolean; readonly shift: boolean }
    | undefined;
}

const pointer = Schema.Struct({ point: SelectionPoint, pointerId: Schema.Int });

export const rectangleMachine = setupEffect({
  schemas: {
    context: types<RectangleContext>(),
    events: {
      CANCEL: Schema.Struct({}),
      CLICK: Schema.Struct({
        key: Schema.String,
        mod: Schema.Boolean,
        shift: Schema.Boolean,
      }),
      DOWN: pointer,
      MOVE: pointer,
      RESET: Schema.Struct({}),
      UP: pointer,
    },
  },
}).createMachine({
  context: {
    click: undefined,
    origin: undefined,
    point: undefined,
    pointerId: undefined,
    revision: 0,
  },
  initial: "idle",
  on: {
    CANCEL: { context: { click: undefined }, target: ".idle" },
    RESET: { context: { click: undefined }, target: ".idle" },
  },
  states: {
    armed: {
      on: {
        MOVE: ({ context, event }) =>
          context.pointerId === event.pointerId &&
          context.origin !== undefined &&
          (Math.abs(context.origin.x - event.point.x) > 5 ||
            Math.abs(context.origin.y - event.point.y) > 5)
            ? { context: { point: event.point }, target: "dragging" }
            : {},
        UP: ({ context, event }) =>
          context.pointerId === event.pointerId ? { target: "idle" } : {},
      },
    },
    completed: {
      on: {
        CANCEL: {},
        CLICK: { context: { click: undefined }, target: "idle" },
      },
    },
    dragging: {
      on: {
        MOVE: ({ context, event }) =>
          context.pointerId === event.pointerId
            ? { context: { point: event.point } }
            : {},
        UP: ({ context, event }) =>
          context.pointerId === event.pointerId
            ? {
                context: { point: event.point, revision: context.revision + 1 },
                target: "completed",
              }
            : {},
      },
    },
    idle: {
      on: {
        CLICK: ({ context, event }) => ({
          context: {
            click: { key: event.key, mod: event.mod, shift: event.shift },
            revision: context.revision + 1,
          },
        }),
        DOWN: ({ event }) => ({
          context: {
            click: undefined,
            origin: event.point,
            point: event.point,
            pointerId: event.pointerId,
          },
          target: "armed",
        }),
      },
    },
  },
});
