import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { initialTransition, transition } from "xstate";
import type { EventFromLogic } from "xstate";

import { zoneDragMachine } from "../src/client/zone-drag/machine.js";
import { displayZone } from "../src/layout/time-zones.js";

const ids = ["America/Los_Angeles", "America/New_York", "Asia/Tokyo"].map(
  (id) => displayZone(id).id
);

const coordinate = Schema.Int.check(
  Schema.isBetween({ maximum: 12, minimum: -12 })
);

const pointer = Schema.Int.check(Schema.isBetween({ maximum: 2, minimum: 0 }));

const destination = Schema.Int.check(
  Schema.isBetween({ maximum: 4, minimum: -1 })
);

const Step = Schema.TaggedUnion({
  Cancel: {},
  Click: {},
  Down: { pointer, slot: destination, x: coordinate, y: coordinate },
  Move: { index: destination, pointer, x: coordinate, y: coordinate },
  Up: { index: destination, pointer, x: coordinate, y: coordinate },
});

it.effect.prop(
  "generated zone drag histories preserve threshold, pointer ownership, cancellation and exactly-once drops",
  {
    history: Schema.Array(Step).check(Schema.isMaxLength(40)),
  },
  ({ history }) =>
    Effect.sync(() => {
      let [snapshot] = initialTransition(zoneDragMachine, { ids });

      let state: "idle" | "pressed" | "dragging" | "cancelled" = "idle";

      let start:
        | { slot: number; pointer: number; x: number; y: number }
        | undefined;

      let preview: { id: string; index: number } | undefined;

      let completed:
        | { id: string; index: number; sequence: number }
        | undefined;

      let sequence = 0;
      let blockClick = false;

      const observeStep = (
        step: typeof Step.Type
      ): EventFromLogic<typeof zoneDragMachine> =>
        Step.match<EventFromLogic<typeof zoneDragMachine>>(step, {
          Cancel: () => {
            if (start !== undefined) {
              state = "cancelled";
              start = undefined;
              preview = undefined;
              completed = undefined;
              blockClick = true;
            }

            return { type: "CANCEL" as const };
          },
          Click: () => {
            blockClick = false;

            return { type: "CLICK" as const };
          },
          Down: ({ pointer: pointerId, slot, x, y }) => {
            const id = ids[slot] ?? displayZone("Europe/London").id;

            if (
              (state === "idle" || state === "cancelled") &&
              slot >= 0 &&
              slot < ids.length
            ) {
              state = "pressed";
              start = { pointer: pointerId, slot, x, y };
              preview = undefined;
              completed = undefined;
              blockClick = false;
            }

            return {
              hostKey: "fixture",
              id,
              ids,
              pointerId,
              type: "DOWN" as const,
              x,
              y,
            };
          },
          Move: ({ index, pointer: pointerId, x, y }) => {
            if (
              start !== undefined &&
              pointerId === start.pointer &&
              (state === "dragging" ||
                Math.abs(x - start.x) > 5 ||
                Math.abs(y - start.y) > 5)
            ) {
              if (state === "pressed") {
                blockClick = true;
              }

              state = "dragging";
              preview = {
                id: ids[start.slot] ?? "",
                index: Math.min(2, Math.max(0, index)),
              };
            }

            return { index, pointerId, type: "MOVE" as const, x, y };
          },
          Up: ({ index, pointer: pointerId, x, y }) => {
            if (start !== undefined && pointerId === start.pointer) {
              const proposed = Math.min(2, Math.max(0, index));

              if (state === "dragging" && proposed !== start.slot) {
                sequence += 1;
                completed = {
                  id: ids[start.slot] ?? "",
                  index: proposed,
                  sequence,
                };
              } else {
                completed = undefined;
              }

              state = "idle";
              start = undefined;
              preview = undefined;
            }

            return { index, pointerId, type: "UP" as const, x, y };
          },
        });

      for (const step of history) {
        [snapshot] = transition(zoneDragMachine, snapshot, observeStep(step));
        expect(snapshot.value).toBe(state);
        expect(Option.getOrUndefined(snapshot.context.preview)).toEqual(
          preview
        );
        expect(Option.getOrUndefined(snapshot.context.completed)).toEqual(
          completed
        );
        expect(snapshot.context.sequence).toBe(sequence);
        expect(snapshot.context.blockClick).toBe(blockClick);
      }
    })
);

it.effect(
  "five pixels stays a click, six pixels starts a drag, and cancel before release cannot produce a drop",
  () =>
    Effect.sync(() => {
      const id = ids[0] ?? displayZone("America/Los_Angeles").id;
      let [snapshot] = initialTransition(zoneDragMachine, { ids });
      [snapshot] = transition(zoneDragMachine, snapshot, {
        hostKey: "fixture",
        id,
        ids,
        pointerId: 1,
        type: "DOWN",
        x: 0,
        y: 0,
      });
      [snapshot] = transition(zoneDragMachine, snapshot, {
        index: 2,
        pointerId: 1,
        type: "MOVE",
        x: 5,
        y: 5,
      });
      expect(snapshot.value).toBe("pressed");
      expect(Option.isNone(snapshot.context.preview)).toBe(true);
      [snapshot] = transition(zoneDragMachine, snapshot, {
        index: 2,
        pointerId: 1,
        type: "MOVE",
        x: 6,
        y: 0,
      });
      expect(snapshot.value).toBe("dragging");
      [snapshot] = transition(zoneDragMachine, snapshot, { type: "CANCEL" });
      [snapshot] = transition(zoneDragMachine, snapshot, {
        index: 2,
        pointerId: 1,
        type: "UP",
        x: 100,
        y: 0,
      });
      expect(snapshot.value).toBe("cancelled");
      expect(Option.isNone(snapshot.context.completed)).toBe(true);
      expect(snapshot.context.sequence).toBe(0);
    })
);
