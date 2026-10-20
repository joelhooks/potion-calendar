import { setupEffect } from "@xstate/effect";
import { Option, Schema } from "effect";
import { types } from "xstate";

import { doubleClick } from "../../layout/edit-time.js";
import { gestureRange } from "../../layout/gesture-range.js";
import type { GestureResult } from "./gesture-model.js";
import { GesturePoint, GestureStart } from "./gesture-model.js";

interface Context {
  readonly blockClick: boolean;
  readonly click: typeof GesturePoint.Type | undefined;
  readonly completed: typeof GestureResult.Type | undefined;
  readonly preview: typeof GestureResult.Type | undefined;
  readonly sequence: number;
  readonly start: typeof GestureStart.Type | undefined;
}

const startFor = (context: Context) =>
  Schema.decodeUnknownSync(GestureStart)(context.start);

export const gestureMachine = setupEffect({
  schemas: {
    context: types<Context>(),
    events: {
      CANCEL: Schema.Struct({}),
      CLICK: Schema.Struct({}),
      DOWN: Schema.Struct({ start: GestureStart }),
      MOVE: Schema.Struct({ point: GesturePoint }),
      UP: Schema.Struct({ point: GesturePoint }),
    },
  },
}).createMachine({
  context: {
    blockClick: false,
    click: undefined,
    completed: undefined,
    preview: undefined,
    sequence: 0,
    start: undefined,
  },
  initial: "idle",
  states: {
    armed: {
      on: {
        CANCEL: {
          context: { preview: undefined, start: undefined },
          target: "idle",
        },
        MOVE: ({ context, event }) => {
          const start = startFor(context);

          if (
            Math.abs(start.point.x - event.point.x) <= 5 &&
            Math.abs(start.point.y - event.point.y) <= 5
          ) {
            return {};
          }

          return {
            context: {
              preview: gestureRange(start, event.point, context.sequence + 1),
            },
            target: "dragging",
          };
        },
        UP: ({ context, event }) => {
          const start = startFor(context);

          if (
            Option.isNone(start.target) &&
            context.click !== undefined &&
            context.click.day === start.point.day &&
            doubleClick(context.click, event.point)
          ) {
            const point = start.allDay
              ? event.point
              : { ...event.point, minute: start.point.minute + 30 };

            return {
              context: {
                blockClick: true,
                click: undefined,
                completed: gestureRange(start, point, context.sequence + 1),
                preview: undefined,
                sequence: context.sequence + 1,
                start: undefined,
              },
              target: "idle",
            };
          }

          return {
            context: {
              click: Option.isNone(start.target) ? event.point : undefined,
              preview: undefined,
              start: undefined,
            },
            target: "idle",
          };
        },
      },
    },
    dragging: {
      on: {
        CANCEL: {
          context: { preview: undefined, start: undefined },
          target: "idle",
        },
        MOVE: ({ context, event }) => ({
          context: {
            preview: gestureRange(
              startFor(context),
              event.point,
              context.sequence + 1
            ),
          },
        }),
        UP: ({ context, event }) => ({
          context: {
            blockClick: true,
            click: undefined,
            completed: gestureRange(
              startFor(context),
              event.point,
              context.sequence + 1
            ),
            preview: undefined,
            sequence: context.sequence + 1,
            start: undefined,
          },
          target: "idle",
        }),
      },
    },
    idle: {
      on: {
        CLICK: { context: { blockClick: false } },
        DOWN: ({ event }) =>
          Option.isSome(event.start.target) &&
          !event.start.target.value.editable &&
          !(event.start.point.alt && event.start.edge === "body")
            ? {}
            : {
                context: { blockClick: false, start: event.start },
                target: "armed",
              },
      },
    },
  },
});
