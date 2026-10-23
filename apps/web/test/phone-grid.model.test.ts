import { expect, it } from "@effect/vitest";
import { createEffectActor } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import { Effect, Queue, Schema } from "effect";
import type { EventFromLogic } from "xstate";

import { phoneTouchMachine } from "../src/client/phone-grid/machine.js";
import {
  PhoneTouchStep as Step,
  initialPhoneReference,
  nextPhoneReference,
} from "./phone-grid-reference.js";

const touchStep = Effect.fn("phoneTouchStep")(function* touchStep(
  actor: EffectActor<typeof phoneTouchMachine>,
  event: EventFromLogic<typeof phoneTouchMachine>
) {
  const queue = yield* Queue.unbounded<ReturnType<typeof actor.getSnapshot>>();

  return yield* Effect.acquireUseRelease(
    Effect.sync(() =>
      actor.subscribe((snapshot) => {
        Queue.offerUnsafe(queue, snapshot);
      })
    ),
    () =>
      Effect.sync(() => {
        actor.send(event);
      }).pipe(Effect.andThen(Queue.take(queue))),
    (subscription) =>
      Effect.sync(() => {
        subscription.unsubscribe();
      })
  );
});

const phoneEvent = (
  step: typeof Step.Type
): EventFromLogic<typeof phoneTouchMachine> => {
  const point = { pointerId: step.pointerId, x: step.x, y: step.y };

  switch (step.kind) {
    case "down": {
      return {
        start: step.enabled ? { ...point, hostKey: "host" } : point,
        type: "DOWN",
      };
    }

    case "move": {
      return { point, type: "MOVE" };
    }

    case "up": {
      return { point, type: "UP" };
    }

    case "hold": {
      return { pointerId: step.pointerId, type: "HOLD" };
    }

    case "cancel": {
      return { type: "CANCEL" };
    }

    case "click": {
      return { type: "CLICK" };
    }

    default: {
      return step.kind satisfies never;
    }
  }
};

it.effect.prop(
  "touch command histories preserve intent, pointer ownership, one navigation and click suppression",
  {
    history: Schema.Array(Step).check(Schema.isMaxLength(40)),
  },
  ({ history }) =>
    Effect.gen(function* histories() {
      const actor = yield* createEffectActor(phoneTouchMachine);
      let reference = initialPhoneReference();

      for (const step of history) {
        yield* touchStep(actor, phoneEvent(step));
        reference = nextPhoneReference(reference, step);
        const snapshot = actor.getSnapshot();
        expect(snapshot.value).toBe(reference.phase);
        expect(snapshot.context.sequence).toBe(reference.sequence);
        expect(snapshot.context.blockClick).toBe(reference.block);
        expect(snapshot.context.start?.pointerId).toBe(
          reference.origin?.pointerId
        );
        expect(snapshot.context.navigation?.direction).toBe(
          reference.direction
        );
      }
    }).pipe(Effect.scoped)
);

it.effect(
  "the M4 held seam preserves initial and latest points and cannot steal a scrolling touch",
  () =>
    Effect.gen(function* heldSeam() {
      const actor = yield* createEffectActor(phoneTouchMachine);
      yield* touchStep(actor, {
        start: { hostKey: "host", pointerId: 1, x: 10, y: 20 },
        type: "DOWN",
      });
      yield* touchStep(actor, {
        point: { pointerId: 1, x: 12, y: 22 },
        type: "MOVE",
      });
      yield* touchStep(actor, { pointerId: 2, type: "HOLD" });
      expect(actor.getSnapshot().value).toBe("pending");
      yield* touchStep(actor, { pointerId: 1, type: "HOLD" });
      expect(actor.getSnapshot().value).toBe("held");
      expect(actor.getSnapshot().context.start).toMatchObject({
        hostKey: "host",
        pointerId: 1,
        x: 10,
        y: 20,
      });
      expect(actor.getSnapshot().context.point).toMatchObject({
        pointerId: 1,
        x: 12,
        y: 22,
      });
      yield* touchStep(actor, {
        point: { pointerId: 1, x: 80, y: 22 },
        type: "UP",
      });
      expect(actor.getSnapshot().context.sequence).toBe(0);
      yield* touchStep(actor, {
        start: { hostKey: "host", pointerId: 1, x: 0, y: 0 },
        type: "DOWN",
      });
      yield* touchStep(actor, {
        point: { pointerId: 1, x: 0, y: 60 },
        type: "MOVE",
      });
      yield* touchStep(actor, { pointerId: 1, type: "HOLD" });
      expect(actor.getSnapshot().value).toBe("scrolling");
      yield* touchStep(actor, {
        point: { pointerId: 1, x: 80, y: 0 },
        type: "UP",
      });
      expect(actor.getSnapshot().context.sequence).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect(
  "48 px is inclusive, ties and vertical dominance never swipe, and release can cancel a horizontal decision",
  () =>
    Effect.gen(function* boundaries() {
      for (const { x, y, navigates } of [
        { navigates: false, x: 47, y: 0 },
        { navigates: true, x: 48, y: 0 },
        { navigates: true, x: -48, y: 0 },
        { navigates: false, x: 48, y: 48 },
        { navigates: false, x: 48, y: 49 },
      ]) {
        const actor = yield* createEffectActor(phoneTouchMachine);
        yield* touchStep(actor, {
          start: { hostKey: "host", pointerId: 1, x: 0, y: 0 },
          type: "DOWN",
        });
        yield* touchStep(actor, {
          point: { pointerId: 1, x, y },
          type: "MOVE",
        });
        yield* touchStep(actor, { point: { pointerId: 1, x, y }, type: "UP" });
        expect(actor.getSnapshot().context.sequence).toBe(navigates ? 1 : 0);
      }

      for (const point of [
        { x: 47, y: 0 },
        { x: 60, y: 70 },
      ]) {
        const actor = yield* createEffectActor(phoneTouchMachine);
        yield* touchStep(actor, {
          start: { hostKey: "host", pointerId: 1, x: 0, y: 0 },
          type: "DOWN",
        });
        yield* touchStep(actor, {
          point: { pointerId: 1, x: 60, y: 0 },
          type: "MOVE",
        });
        yield* touchStep(actor, {
          point: { pointerId: 1, ...point },
          type: "UP",
        });
        expect(actor.getSnapshot().context.sequence).toBe(0);
        expect(actor.getSnapshot().context.blockClick).toBe(true);
      }
    }).pipe(Effect.scoped)
);
