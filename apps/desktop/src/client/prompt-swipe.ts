import { setup, types } from "xstate";

interface SwipePoint {
  readonly at: number;
  readonly pointer: number;
  readonly x: number;
  readonly y: number;
}

interface SwipeContext extends SwipePoint {
  readonly dx: number;
  readonly dy: number;
  readonly width: number;
}

const moved = (context: SwipeContext, point: SwipePoint) => ({
  ...context,
  dx: point.x - context.x,
  dy: point.y - context.y,
});

const dismisses = (context: SwipeContext, point: SwipePoint): boolean => {
  const dx = point.x - context.x;
  const dy = point.y - context.y;
  const elapsed = point.at - context.at;

  return (
    context.width > 0 &&
    dx > 0 &&
    dx > Math.abs(dy) &&
    (dx > context.width * 0.4 ||
      (dx >= 16 && elapsed > 0 && dx / elapsed >= 0.6))
  );
};

export const promptSwipe = setup({
  schemas: {
    context: types<SwipeContext>(),
    events: {
      Cancel: types<{ readonly pointer: number }>(),
      Click: types<Record<never, never>>(),
      Dismiss: types<Record<never, never>>(),
      End: types<SwipePoint>(),
      Move: types<SwipePoint>(),
      Start: types<SwipePoint & { readonly width: number }>(),
    },
  },
}).createMachine({
  context: { at: 0, dx: 0, dy: 0, pointer: -1, width: 0, x: 0, y: 0 },
  initial: "idle",
  on: {
    Dismiss: { target: ".dismissed" },
    Start: ({ event }) => ({
      context: {
        at: event.at,
        dx: 0,
        dy: 0,
        pointer: event.pointer,
        width: event.width,
        x: event.x,
        y: event.y,
      },
      target: ".tracking",
    }),
  },
  states: {
    dismissed: { type: "final" },
    dragging: {
      on: {
        Cancel: ({ context, event }) =>
          event.pointer === context.pointer ? { target: "settled" } : {},
        End: ({ context, event }) =>
          event.pointer === context.pointer
            ? {
                context: moved(context, event),
                target: dismisses(context, event) ? "dismissed" : "settled",
              }
            : {},
        Move: ({ context, event }) =>
          event.pointer === context.pointer
            ? {
                context: moved(context, event),
                target:
                  Math.abs(event.y - context.y) > Math.abs(event.x - context.x)
                    ? "vertical"
                    : "dragging",
              }
            : {},
      },
    },
    idle: {},
    settled: { on: { Click: { target: "idle" } } },
    tracking: {
      on: {
        Cancel: ({ context, event }) =>
          event.pointer === context.pointer ? { target: "settled" } : {},
        End: ({ context, event }) =>
          event.pointer === context.pointer
            ? {
                context: moved(context, event),
                target: dismisses(context, event) ? "dismissed" : "idle",
              }
            : {},
        Move: ({ context, event }) => {
          if (event.pointer !== context.pointer) {
            return {};
          }

          const next = moved(context, event);

          if (Math.abs(next.dy) >= 8 && Math.abs(next.dy) > Math.abs(next.dx)) {
            return { context: next, target: "vertical" };
          }

          return {
            context: next,
            target:
              Math.abs(next.dx) >= 8 && Math.abs(next.dx) > Math.abs(next.dy)
                ? "dragging"
                : "tracking",
          };
        },
      },
    },
    vertical: {
      on: {
        Cancel: ({ context, event }) =>
          event.pointer === context.pointer ? { target: "settled" } : {},
        End: ({ context, event }) =>
          event.pointer === context.pointer ? { target: "settled" } : {},
      },
    },
  },
});
