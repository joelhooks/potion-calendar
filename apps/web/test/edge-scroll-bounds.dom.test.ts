import { watchActor } from "@calendar/capability/actor-watch";
import { expect, it } from "@effect/vitest";
import { createEffectActor } from "@xstate/effect";
import { Effect, Queue, Schema } from "effect";

import { bindGestureEvents } from "../src/client/editing/gesture-events.js";
import { gestureMachine } from "../src/client/editing/gesture-machine.js";
import { GestureTarget } from "../src/client/editing/gesture-model.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { editorOriginal } from "./editor-fixture.js";

const fire = (
  type: string,
  x: number,
  y = 200,
  pointerId = 1,
  receiver: EventTarget = window
): void => {
  receiver.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: x,
      clientY: y,
      isPrimary: true,
      pointerId,
    })
  );
};

const boundedHarness = Effect.fn("boundedEdgeHarness")(
  function* boundedEdgeHarness(
    allDay: boolean,
    maximum: number,
    initial: number,
    month?: boolean,
    editable?: boolean
  ) {
    const monthView = month === true;
    const day = dayFromIso("2026-10-19");
    const root = document.createElement("div");
    root.className = monthView ? "month-view" : "time-view";
    const timeCell = allDay ? "all-day-cell" : "day-column";
    const cellClass = monthView ? "month-cell" : timeCell;

    root.innerHTML = `<div id="${monthView ? "month" : "time"}-viewport"><div class="${allDay ? "all-day" : "timed"}"><div class="${cellClass}" data-day="${day}"><button class="event-chip selected" data-event-key="edge-unit">Event</button></div></div></div>`;
    document.body.append(root);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        root.remove();
      })
    );

    const viewport = yield* Effect.fromNullishOr(
      root.querySelector<HTMLElement>("[id$='-viewport']")
    );

    viewport.getBoundingClientRect = () => new DOMRect(100, 100, 400, 400);
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 400 },
      scrollWidth: { configurable: true, value: 400 + maximum },
    });
    viewport.scrollLeft = initial;
    viewport.scrollTop = 300;

    const cell = yield* Effect.fromNullishOr(
      viewport.querySelector<HTMLElement>("[data-day]")
    );

    cell.getBoundingClientRect = () => new DOMRect(-2000, -2000, 5000, 5000);
    const chip = yield* Effect.fromNullishOr(cell.querySelector("button"));

    const target = GestureTarget.make({
      allDay,
      editable: editable !== false,
      end: day * 1440 + (allDay ? 1440 : 600),
      event: allDay
        ? {
            ...editorOriginal,
            end: { date: "2026-10-20" },
            start: { date: "2026-10-19" },
          }
        : editorOriginal,
      key: "edge-unit",
      start: day * 1440 + (allDay ? 0 : 540),
    });

    const actor = yield* createEffectActor(gestureMachine);
    yield* watchActor("calendar.edge-scroll.bounds", actor);

    const release = yield* Effect.acquireRelease(
      Effect.sync(() =>
        bindGestureEvents({
          actor,
          getTargets: () => [target],
          root,
          scale: 60,
        })
      ),
      (dispose) => Effect.sync(dispose)
    );

    const step = Effect.fn("boundedEdgeStep")(function* boundedEdgeStep(
      type: string,
      x: number,
      receiver: EventTarget = window
    ) {
      const notices =
        yield* Queue.unbounded<ReturnType<typeof actor.getSnapshot>>();

      return yield* Effect.acquireUseRelease(
        Effect.sync(() =>
          actor.subscribe((snapshot) => {
            Queue.offerUnsafe(notices, snapshot);
          })
        ),
        () =>
          Effect.sync(() => {
            fire(type, x, 200, 1, receiver);
          }).pipe(Effect.andThen(Queue.take(notices))),
        (subscription) =>
          Effect.sync(() => {
            subscription.unsubscribe();
          })
      );
    });

    return { actor, chip, fire, release, step, viewport };
  }
);

it.effect.prop(
  "horizontal drag offsets obey native bounds and all-day movement never scrolls hours",
  {
    allDay: Schema.Boolean,
    direction: Schema.Literals([-1, 1]),
    distance: Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: 1 })),
    initial: Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: 0 })),
    maximum: Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: 0 })),
  },
  ({ allDay, direction, distance, initial, maximum }) =>
    Effect.scoped(
      Effect.gen(function* generatedBounds() {
        const before = Math.min(initial, maximum);
        const h = yield* boundedHarness(allDay, maximum, before);
        yield* h.step("pointerdown", 200, h.chip);
        yield* h.step("pointermove", 206);
        expect(h.actor.getSnapshot().matches("dragging")).toBe(true);
        h.fire(
          "pointermove",
          direction < 0 ? 100 - distance : 500 + distance,
          allDay ? 700 : 200
        );
        expect(h.viewport.scrollLeft).toBe(
          Math.max(0, Math.min(maximum, before + direction * distance))
        );
        expect(h.viewport.scrollTop).toBe(300);
      })
    )
);

it.effect.each(["idle", "armed", "foreign", "released", "ineligible"] as const)(
  "%s input cannot scroll a viewport",
  (kind) =>
    Effect.gen(function* inactiveEdge() {
      const h = yield* boundedHarness(
        false,
        200,
        50,
        false,
        kind !== "ineligible"
      );

      if (kind !== "idle" && kind !== "ineligible") {
        yield* h.step("pointerdown", 200, h.chip);

        if (kind !== "armed") {
          yield* h.step("pointermove", 206);
        }
      }

      if (kind === "ineligible") {
        h.fire("pointerdown", 200, 200, 1, h.chip);
        expect(h.actor.getSnapshot().context.start).toBeUndefined();
      }

      if (kind === "released") {
        h.release();
      }

      h.fire("pointermove", 700, 200, kind === "foreign" ? 2 : 1);
      expect(h.viewport.scrollLeft).toBe(50);
    })
);

it.effect(
  "Month retains vertical edge scrolling without borrowing the time grid's horizontal axis",
  () =>
    Effect.gen(function* monthAxis() {
      const h = yield* boundedHarness(true, 200, 50, true);
      yield* h.step("pointerdown", 200, h.chip);
      yield* h.step("pointermove", 206);
      expect(h.actor.getSnapshot().matches("dragging")).toBe(true);
      h.fire("pointermove", 700, 700);
      expect(h.viewport.scrollLeft).toBe(50);
      expect(h.viewport.scrollTop).toBe(500);
    })
);
