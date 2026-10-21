import type { EffectActor } from "@xstate/effect";
import { Option, Result } from "effect";

import { platformModifier } from "../keyboard/modifier.js";
import { monthGestureStart } from "../month/gesture.js";
import type { MonthGestureRefused } from "../month/gesture.js";
import { pointerPoint } from "./gesture-input.js";
import type { gestureMachine } from "./gesture-machine.js";
import type { GestureTarget } from "./gesture-model.js";

interface Input {
  readonly actor: EffectActor<typeof gestureMachine>;
  readonly root: HTMLElement;
  readonly scale: number;
  readonly getTargets: () => readonly (typeof GestureTarget.Type)[] | undefined;
  readonly refused?: (reason: MonthGestureRefused["reason"]) => void;
}

const scrollEdge = (
  root: HTMLElement,
  event: PointerEvent,
  allDay: boolean
): void => {
  const month = root.classList.contains("month-view");

  const viewport = root.querySelector<HTMLElement>(
    month ? "#month-viewport" : "#time-viewport"
  );

  if (viewport === null) {
    return;
  }

  const rect = viewport.getBoundingClientRect();

  if (!month) {
    const horizontal =
      event.clientX < rect.left
        ? event.clientX - rect.left
        : Math.max(0, event.clientX - rect.right);

    const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);

    if (horizontal !== 0 && maximum > 0) {
      viewport.scrollLeft = Math.max(
        0,
        Math.min(maximum, viewport.scrollLeft + horizontal)
      );
    }
  }

  if (month || !allDay) {
    const vertical =
      event.clientY < rect.top
        ? event.clientY - rect.top
        : Math.max(0, event.clientY - rect.bottom);

    viewport.scrollTop += vertical;
  }
};

const startsOnSurface = (
  element: Element,
  chip: HTMLElement | null
): boolean =>
  chip === null
    ? element.closest("button,input,select,textarea,a") === null &&
      element.closest(".day-column,.all-day-cell,.month-cell[data-day]") !==
        null
    : chip.classList.contains("selected");

const selectionGesture = (root: HTMLElement, event: PointerEvent): boolean =>
  (event.shiftKey && !platformModifier(event)) ||
  (!root.classList.contains("month-view") &&
    Number(root.dataset.selectionCount ?? 0) > 1);

const gestureElement = (
  root: HTMLElement,
  event: PointerEvent
): Element | undefined =>
  event.button === 0 &&
  !selectionGesture(root, event) &&
  event.isPrimary &&
  event.target instanceof Element &&
  event.target.closest("[data-month-parked]") === null
    ? event.target
    : undefined;

const canDragTarget = (
  target: typeof GestureTarget.Type | undefined,
  event: PointerEvent,
  edge: "body" | "start" | "end"
) =>
  target === undefined || target.editable || (event.altKey && edge === "body");

export const bindGestureEvents = ({
  actor,
  root,
  scale,
  getTargets,
  refused,
}: Input): (() => void) => {
  const down = (event: PointerEvent): void => {
    const element = gestureElement(root, event);

    if (element === undefined) {
      return;
    }

    const targets = getTargets();

    if (targets === undefined) {
      return;
    }

    const chip = element.closest<HTMLElement>(".event-chip");

    if (!startsOnSurface(element, chip)) {
      return;
    }

    const allDay =
      root.classList.contains("month-view") ||
      element.closest(".all-day") !== null;

    const point = pointerPoint(root, event, scale, allDay);

    if (Option.isNone(point)) {
      return;
    }

    const target = targets.find((item) => item.key === chip?.dataset.eventKey);

    if (chip !== null && target === undefined) {
      return;
    }

    const handle =
      element.closest<HTMLElement>("[data-resize-edge]")?.dataset.resizeEdge;

    const edge = handle === "start" || handle === "end" ? handle : "body";

    if (root.classList.contains("month-view")) {
      const start = monthGestureStart({
        edge,
        point: point.value,
        selected: chip?.classList.contains("selected") ?? false,
        target: Option.fromUndefinedOr(target),
      });

      if (Result.isFailure(start)) {
        refused?.(start.failure.reason);

        return;
      }

      actor.send({ start: start.success, type: "DOWN" });
      root.setPointerCapture?.(event.pointerId);
      event.preventDefault();

      return;
    }

    if (!canDragTarget(target, event, edge)) {
      return;
    }

    actor.send({
      start: {
        allDay,
        edge,
        point: point.value,
        target: Option.fromUndefinedOr(target),
      },
      type: "DOWN",
    });
    root.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const move = (event: PointerEvent): void => {
    const { start } = actor.getSnapshot().context;

    if (start === undefined || start.point.pointerId !== event.pointerId) {
      return;
    }

    if (actor.getSnapshot().matches("dragging")) {
      scrollEdge(root, event, start.allDay);
    }

    const point = pointerPoint(root, event, scale, start.allDay);

    if (Option.isSome(point)) {
      actor.send({ point: point.value, type: "MOVE" });
    }

    event.preventDefault();
  };

  const up = (event: PointerEvent): void => {
    const { start } = actor.getSnapshot().context;

    if (start === undefined || start.point.pointerId !== event.pointerId) {
      return;
    }

    const point = pointerPoint(root, event, scale, start.allDay);

    if (Option.isSome(point)) {
      actor.send({ point: point.value, type: "UP" });
    } else {
      actor.send({ type: "CANCEL" });
    }

    if (root.hasPointerCapture?.(event.pointerId)) {
      root.releasePointerCapture(event.pointerId);
    }

    event.preventDefault();
  };

  const cancel = (): void => {
    actor.send({ type: "CANCEL" });
  };

  const key = (event: KeyboardEvent): void => {
    if (
      event.key === "Escape" &&
      actor.getSnapshot().context.start !== undefined
    ) {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  };

  const click = (event: MouseEvent): void => {
    if (!(event.target instanceof Node) || !root.contains(event.target)) {
      return;
    }

    if (actor.getSnapshot().context.blockClick) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    actor.send({ type: "CLICK" });
  };

  root.addEventListener("pointerdown", down);
  root.addEventListener("lostpointercapture", cancel);
  window.addEventListener("click", click, true);
  window.addEventListener("pointermove", move, {
    capture: true,
    passive: false,
  });
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", cancel);
  window.addEventListener("keydown", key, true);

  return () => {
    cancel();
    root.removeEventListener("pointerdown", down);
    root.removeEventListener("lostpointercapture", cancel);
    window.removeEventListener("click", click, true);
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", cancel);
    window.removeEventListener("keydown", key, true);
  };
};
