import { setupEffect } from "@xstate/effect";
import { Schema } from "effect";
import { types } from "xstate";

export const TouchPoint = Schema.Struct({
  pointerId: Schema.Int,
  x: Schema.Finite,
  y: Schema.Finite,
});

export const TouchStart = Schema.Struct({
  ...TouchPoint.fields,
  hostKey: Schema.optionalKey(Schema.String),
});

interface Context {
  readonly start: typeof TouchStart.Type | undefined;
  readonly point: typeof TouchPoint.Type | undefined;
  readonly blockClick: boolean;
  readonly sequence: number;
  readonly navigation:
    | {
        readonly id: number;
        readonly hostKey: string;
        readonly direction: -1 | 1;
      }
    | undefined;
}

const horizontalSwipe = (
  start: typeof TouchStart.Type,
  point: typeof TouchPoint.Type
): boolean =>
  Math.abs(point.x - start.x) >= 48 &&
  Math.abs(point.x - start.x) > Math.abs(point.y - start.y);

const finishTouch = (context: Context, point: typeof TouchPoint.Type) => {
  const { start } = context;

  if (start === undefined || start.pointerId !== point.pointerId) {
    return {};
  }

  const displaced =
    Math.max(Math.abs(point.x - start.x), Math.abs(point.y - start.y)) >= 48;

  const complete = start.hostKey !== undefined && horizontalSwipe(start, point);

  return {
    context: {
      blockClick: context.blockClick || displaced,
      navigation:
        complete && start.hostKey !== undefined
          ? {
              direction: point.x < start.x ? (1 as const) : (-1 as const),
              hostKey: start.hostKey,
              id: context.sequence + 1,
            }
          : context.navigation,
      point: undefined,
      sequence: context.sequence + (complete ? 1 : 0),
      start: undefined,
    },
    target: "idle",
  };
};

export const phoneTouchMachine = setupEffect({
  schemas: {
    context: types<Context>(),
    events: {
      CANCEL: Schema.Struct({}),
      CLICK: Schema.Struct({}),
      DOWN: Schema.Struct({ start: TouchStart }),
      HOLD: Schema.Struct({ pointerId: Schema.Int }),
      MOVE: Schema.Struct({ point: TouchPoint }),
      UP: Schema.Struct({ point: TouchPoint }),
    },
  },
}).createMachine({
  context: {
    blockClick: false,
    navigation: undefined,
    point: undefined,
    sequence: 0,
    start: undefined,
  },
  initial: "idle",
  on: {
    CANCEL: ({ context }) => ({
      context: {
        blockClick: context.start !== undefined || context.blockClick,
        point: undefined,
        start: undefined,
      },
      target: ".idle",
    }),
  },
  states: {
    held: {
      on: {
        MOVE: ({ context, event }) =>
          context.start?.pointerId === event.point.pointerId
            ? { context: { point: event.point } }
            : {},
        UP: ({ context, event }) =>
          context.start?.pointerId === event.point.pointerId
            ? {
                context: { point: undefined, start: undefined },
                target: "idle",
              }
            : {},
      },
    },
    idle: {
      on: {
        CLICK: { context: { blockClick: false } },
        DOWN: ({ event }) => ({
          context: {
            blockClick: false,
            point: event.start,
            start: event.start,
          },
          target: "pending",
        }),
      },
    },
    pending: {
      on: {
        DOWN: {
          context: { blockClick: true, point: undefined, start: undefined },
          target: "idle",
        },
        HOLD: ({ context, event }) =>
          context.start?.pointerId === event.pointerId
            ? { context: { blockClick: true }, target: "held" }
            : {},
        MOVE: ({ context, event }) => {
          const { start } = context;

          if (
            start === undefined ||
            start.pointerId !== event.point.pointerId
          ) {
            return {};
          }

          if (
            Math.max(
              Math.abs(event.point.x - start.x),
              Math.abs(event.point.y - start.y)
            ) < 48
          ) {
            return { context: { point: event.point } };
          }

          return {
            context: { blockClick: true, point: event.point },
            target:
              start.hostKey !== undefined && horizontalSwipe(start, event.point)
                ? "swiping"
                : "scrolling",
          };
        },
        UP: ({ context, event }) => finishTouch(context, event.point),
      },
    },
    scrolling: {
      on: {
        UP: ({ context, event }) =>
          context.start?.pointerId === event.point.pointerId
            ? {
                context: { point: undefined, start: undefined },
                target: "idle",
              }
            : {},
      },
    },
    swiping: {
      on: {
        MOVE: ({ context, event }) =>
          context.start?.pointerId === event.point.pointerId
            ? { context: { point: event.point } }
            : {},
        UP: ({ context, event }) => finishTouch(context, event.point),
      },
    },
  },
});
