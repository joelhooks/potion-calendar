import { setupEffect } from "@xstate/effect";
import { Option, Schema } from "effect";

import { ZoneId } from "../../layout/time-zones.js";
import {
  ZoneDragDown,
  ZoneDragPoint,
  ZoneDragPreview,
  ZoneDragResult,
  ZoneDragStart,
} from "./model.js";

const DragContext = Schema.Struct({
  blockClick: Schema.Boolean,
  completed: Schema.Option(ZoneDragResult),
  hostKey: Schema.String,
  ids: Schema.Array(ZoneId),
  preview: Schema.Option(ZoneDragPreview),
  sequence: Schema.Int,
  start: Schema.Option(ZoneDragStart),
});

type DragContextValue = typeof DragContext.Type;

const pressZone = ({ event }: { readonly event: typeof ZoneDragDown.Type }) =>
  event.ids.includes(event.id)
    ? {
        context: {
          blockClick: false,
          completed: Option.none(),
          hostKey: event.hostKey,
          ids: event.ids,
          preview: Option.none(),
          start: Option.some(
            ZoneDragStart.make({
              id: event.id,
              pointerId: event.pointerId,
              x: event.x,
              y: event.y,
            })
          ),
        },
        target: "pressed",
      }
    : {};

const proposedIndex = (context: DragContextValue, index: number) =>
  Math.max(0, Math.min(context.ids.length - 1, index));

export const zoneDragMachine = setupEffect({
  schemas: {
    context: DragContext,
    events: {
      CANCEL: Schema.Struct({}),
      CLICK: Schema.Struct({}),
      DOWN: ZoneDragDown,
      MOVE: Schema.Struct({ ...ZoneDragPoint.fields, index: Schema.Int }),
      UP: Schema.Struct({ ...ZoneDragPoint.fields, index: Schema.Int }),
    },
    input: Schema.Struct({ ids: Schema.Array(ZoneId) }),
  },
}).createMachine({
  context: ({ input }) => ({
    blockClick: false,
    completed: Option.none(),
    hostKey: "",
    ids: input.ids,
    preview: Option.none(),
    sequence: 0,
    start: Option.none(),
  }),
  initial: "idle",
  on: {
    CANCEL: ({ context }) =>
      Option.isSome(context.start)
        ? {
            context: {
              blockClick: true,
              completed: Option.none(),
              preview: Option.none(),
              start: Option.none(),
            },
            target: ".cancelled",
          }
        : {},
    CLICK: { context: { blockClick: false } },
  },
  states: {
    cancelled: { on: { DOWN: pressZone } },
    dragging: {
      on: {
        MOVE: ({ context, event }) =>
          Option.isSome(context.start) &&
          context.start.value.pointerId === event.pointerId
            ? {
                context: {
                  preview: Option.some(
                    ZoneDragPreview.make({
                      id: context.start.value.id,
                      index: proposedIndex(context, event.index),
                    })
                  ),
                },
              }
            : {},
        UP: ({ context, event }) => {
          if (
            Option.isNone(context.start) ||
            context.start.value.pointerId !== event.pointerId
          ) {
            return {};
          }

          const { id } = context.start.value;
          const index = proposedIndex(context, event.index);
          const changed = index !== context.ids.indexOf(id);
          const sequence = context.sequence + (changed ? 1 : 0);

          return {
            context: {
              completed: changed
                ? Option.some(ZoneDragResult.make({ id, index, sequence }))
                : Option.none(),
              preview: Option.none(),
              sequence,
              start: Option.none(),
            },
            target: "idle",
          };
        },
      },
    },
    idle: { on: { DOWN: pressZone } },
    pressed: {
      on: {
        MOVE: ({ context, event }) => {
          if (
            Option.isNone(context.start) ||
            context.start.value.pointerId !== event.pointerId
          ) {
            return {};
          }

          const start = context.start.value;

          if (
            Math.abs(start.x - event.x) <= 5 &&
            Math.abs(start.y - event.y) <= 5
          ) {
            return {};
          }

          return {
            context: {
              blockClick: true,
              preview: Option.some(
                ZoneDragPreview.make({
                  id: start.id,
                  index: proposedIndex(context, event.index),
                })
              ),
            },
            target: "dragging",
          };
        },
        UP: ({ context, event }) =>
          Option.isSome(context.start) &&
          context.start.value.pointerId === event.pointerId
            ? {
                context: {
                  completed: Option.none(),
                  preview: Option.none(),
                  start: Option.none(),
                },
                target: "idle",
              }
            : {},
      },
    },
  },
});
