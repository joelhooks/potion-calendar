import { watchActor } from "@calendar/capability/actor-watch";
import { expect, it } from "@effect/vitest";
import { createEffectActor } from "@xstate/effect";
import { Effect, Option, Queue } from "effect";

import { eventKey } from "../src/client/calendar-state.js";
import { bindGestureEvents } from "../src/client/editing/gesture-events.js";
import { gestureMachine } from "../src/client/editing/gesture-machine.js";
import { GestureTarget } from "../src/client/editing/gesture-model.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { editorOriginal } from "./editor-fixture.js";

const day = dayFromIso("2026-10-19");

const monthEvent = {
  ...editorOriginal,
  end: { dateTime: "2026-10-19T09:57:00-07:00" },
  start: { dateTime: "2026-10-19T09:07:00-07:00" },
};

const target = GestureTarget.make({
  allDay: false,
  editable: true,
  end: day * 1440 + 597,
  event: monthEvent,
  key: eventKey(monthEvent),
  start: day * 1440 + 547,
});

const harness = Effect.fn("monthGestureHarness")(function* harness(
  withTarget: boolean
) {
  const root = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const element = document.createElement("section");
      element.className = "month-view";
      element.innerHTML = `<div id="month-viewport"><div class="month-cell" data-day="${day}">${withTarget ? '<button class="event-chip selected">Saved event</button>' : ""}<button class="month-date">19</button></div><div class="month-cell" data-day="${day + 7}"></div></div>`;
      const chip = element.querySelector<HTMLElement>(".event-chip");

      if (chip !== null) {
        chip.dataset.eventKey = target.key;
      }

      document.body.append(element);

      return element;
    }),
    (element) =>
      Effect.sync(() => {
        element.remove();
      })
  );

  const cells = [...root.querySelectorAll<HTMLElement>(".month-cell")];

  for (const [index, cell] of cells.entries()) {
    cell.getBoundingClientRect = () =>
      new DOMRect(100, 100 + index * 100, 100, 100);
  }

  const viewport = yield* Effect.fromNullishOr(
    root.querySelector<HTMLElement>("#month-viewport")
  );

  viewport.getBoundingClientRect = () => new DOMRect(100, 100, 100, 200);
  const actor = yield* createEffectActor(gestureMachine);
  yield* watchActor("calendar.month.gesture.test", actor);

  const release = yield* Effect.acquireRelease(
    Effect.sync(() =>
      bindGestureEvents({
        actor,
        getTargets: () => (withTarget ? [target] : []),
        root,
        scale: 100,
      })
    ),
    (unbind) => Effect.sync(unbind)
  );

  const send = Effect.fn("monthNativeEvent")(function* send(
    event: Event,
    element: EventTarget = window
  ) {
    const snapshots =
      yield* Queue.unbounded<ReturnType<typeof actor.getSnapshot>>();

    return yield* Effect.acquireUseRelease(
      Effect.sync(() =>
        actor.subscribe((snapshot) => {
          Queue.offerUnsafe(snapshots, snapshot);
        })
      ),
      () =>
        Effect.sync(() => {
          element.dispatchEvent(event);
        }).pipe(Effect.andThen(Queue.take(snapshots))),
      (subscription) =>
        Effect.sync(() => {
          subscription.unsubscribe();
        })
    );
  });

  const dispatch = (
    type: string,
    y: number,
    element: EventTarget = window,
    alt = false
  ) =>
    send(
      new PointerEvent(type, {
        altKey: alt,
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: 150,
        clientY: y,
        isPrimary: true,
        pointerId: 7,
      }),
      element
    );

  return { actor, cells, dispatch, release, root, send, viewport };
});

it.effect(
  "a native month move across week rows preserves the timed event's clock instead of converting it to all-day",
  () =>
    Effect.gen(function* monthMove() {
      const h = yield* harness(true);

      const chip = yield* Effect.fromNullishOr(
        h.root.querySelector(".event-chip")
      );

      yield* h.dispatch("pointerdown", 150, chip);
      yield* h.dispatch("pointermove", 250);
      const ended = yield* h.dispatch("pointerup", 250);
      const result = yield* Effect.fromNullishOr(ended.context.completed);
      expect(result.range).toEqual({
        allDay: false,
        endDate: "2026-10-26",
        endTime: "09:57",
        startDate: "2026-10-26",
        startTime: "09:07",
      });
      expect(result.target).toEqual(Option.some(target));
      expect(result.duplicate).toBe(false);
    })
);

it.effect(
  "Alt month movement requests a single-instance duplicate while preserving its original type and clock",
  () =>
    Effect.gen(function* monthDuplicate() {
      const h = yield* harness(true);

      const chip = yield* Effect.fromNullishOr(
        h.root.querySelector(".event-chip")
      );

      yield* h.dispatch("pointerdown", 150, chip, true);
      yield* h.dispatch("pointermove", 250, window, true);
      const ended = yield* h.dispatch("pointerup", 250, window, true);
      const result = yield* Effect.fromNullishOr(ended.context.completed);
      expect(result.duplicate).toBe(true);
      expect(result.range).toMatchObject({
        allDay: false,
        endTime: "09:57",
        startTime: "09:07",
      });
      expect(result.target).toEqual(Option.some(target));
    })
);

it.effect(
  "month drag edge scrolling stays in its viewport and Escape cancels without completion",
  () =>
    Effect.gen(function* monthEdgeAndCancel() {
      const h = yield* harness(true);

      const chip = yield* Effect.fromNullishOr(
        h.root.querySelector(".event-chip")
      );

      yield* h.dispatch("pointerdown", 150, chip);
      yield* h.dispatch("pointermove", 250);
      yield* h.dispatch("pointermove", 350);
      expect(h.viewport.scrollTop).toBe(50);

      const cancelled = yield* h.send(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Escape",
        })
      );

      expect(cancelled.context.start).toBeUndefined();
      expect(cancelled.context.preview).toBeUndefined();
      expect(cancelled.context.completed).toBeUndefined();
    })
);

it.effect(
  "empty month drag creates a date-only range while date navigation buttons do not arm event creation",
  () =>
    Effect.gen(function* monthCreate() {
      const h = yield* harness(false);

      const button = yield* Effect.fromNullishOr(
        h.root.querySelector(".month-date")
      );

      button.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 150,
          clientY: 150,
          isPrimary: true,
          pointerId: 7,
        })
      );
      expect(h.actor.getSnapshot().context.start).toBeUndefined();
      const cell = yield* Effect.fromNullishOr(h.cells[0]);
      yield* h.dispatch("pointerdown", 150, cell);
      yield* h.dispatch("pointermove", 250);
      const ended = yield* h.dispatch("pointerup", 250);
      const result = yield* Effect.fromNullishOr(ended.context.completed);
      expect(result.range).toEqual({
        allDay: true,
        endDate: "2026-10-26",
        endTime: "00:00",
        startDate: "2026-10-19",
        startTime: "00:00",
      });
      expect(Option.isNone(result.target)).toBe(true);
      yield* h.dispatch("pointerdown", 150, cell);

      const cancelled =
        yield* Queue.unbounded<ReturnType<typeof h.actor.getSnapshot>>();

      yield* Effect.acquireUseRelease(
        Effect.sync(() =>
          h.actor.subscribe((snapshot) => {
            Queue.offerUnsafe(cancelled, snapshot);
          })
        ),
        () =>
          Effect.sync(h.release).pipe(Effect.andThen(Queue.take(cancelled))),
        (subscription) =>
          Effect.sync(() => {
            subscription.unsubscribe();
          })
      );
      expect(h.actor.getSnapshot().context.start).toBeUndefined();
      cell.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 150,
          clientY: 150,
          isPrimary: true,
          pointerId: 7,
        })
      );
      expect(h.actor.getSnapshot().context.start).toBeUndefined();
    })
);
