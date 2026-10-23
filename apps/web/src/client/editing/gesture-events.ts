import type { EffectActor } from "@xstate/effect";
import { Option } from "effect";

import { gridGeometry } from "../../layout/geometry.js";
import type { TimeGridGeometry } from "../../layout/geometry.js";
import type { MonthGestureRefused } from "../month/gesture.js";
import type { phoneTouchMachine } from "../phone-grid/machine.js";
import { bindGestureHold, supportsTouchHold } from "./gesture-hold.js";
import { pointerPoint } from "./gesture-input.js";
import type { gestureMachine } from "./gesture-machine.js";
import type { GestureTarget } from "./gesture-model.js";
import { pointerGestureStart } from "./gesture-start.js";
import { bindTouchSurfaces } from "./touch-surfaces.js";

interface Input {
  readonly actor: EffectActor<typeof gestureMachine>;
  readonly getTargets: () => readonly (typeof GestureTarget.Type)[] | undefined;
  readonly grid?: TimeGridGeometry;
  readonly phoneTouch?: EffectActor<typeof phoneTouchMachine>;
  readonly refused?: (reason: MonthGestureRefused["reason"]) => void;
  readonly root: HTMLElement;
  readonly scale: number;
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

export const bindGestureEvents = ({
  actor,
  getTargets,
  phoneTouch,
  refused,
  root,
  scale,
  grid = gridGeometry(scale),
}: Input): (() => void) => {
  const releaseHold = bindGestureHold({
    actor,
    getTargets,
    phoneTouch,
    refused,
    root,
  });

  const cancel = (): void => {
    const pointerId = phoneTouch?.getSnapshot().context.start?.pointerId;

    actor.send({ type: "CANCEL" });

    if (pointerId !== undefined) {
      phoneTouch?.send({ type: "CANCEL" });

      if (root.hasPointerCapture?.(pointerId)) {
        root.releasePointerCapture(pointerId);
      }
    }
  };

  const down = (event: PointerEvent): void => {
    const touch = event.pointerType === "touch";

    if (touch && !supportsTouchHold(root, phoneTouch)) {
      return;
    }

    const targets = getTargets();

    if (targets === undefined) {
      return;
    }

    const start = pointerGestureStart({
      event,
      grid,
      refused,
      root,
      scale,
      targets,
    });

    if (Option.isNone(start)) {
      return;
    }

    if (touch) {
      root.style.setProperty("--touch-press-x", `${event.clientX}px`);
      root.style.setProperty("--touch-press-y", `${event.clientY}px`);
    }

    actor.send({ start: start.value, type: touch ? "PRESS" : "DOWN" });

    if (!touch) {
      root.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    }
  };

  const move = (event: PointerEvent): void => {
    const { start } = actor.getSnapshot().context;

    if (start === undefined || start.point.pointerId !== event.pointerId) {
      return;
    }

    if (actor.getSnapshot().matches("dragging")) {
      scrollEdge(root, event, start.allDay);
    }

    const point = pointerPoint(root, event, scale, start.allDay, grid);

    const pending =
      actor.getSnapshot().matches("pressed") ||
      actor.getSnapshot().matches("ready");

    if (Option.isSome(point)) {
      actor.send({ point: point.value, type: "MOVE" });
    } else {
      cancel();
    }

    if (!pending) {
      event.preventDefault();
    }
  };

  const up = (event: PointerEvent): void => {
    const { start } = actor.getSnapshot().context;

    if (start === undefined || start.point.pointerId !== event.pointerId) {
      return;
    }

    const point = pointerPoint(root, event, scale, start.allDay, grid);

    const pending =
      actor.getSnapshot().matches("pressed") ||
      actor.getSnapshot().matches("ready");

    if (Option.isSome(point)) {
      actor.send({ point: point.value, type: "UP" });
    } else {
      actor.send({ type: "CANCEL" });
    }

    if (root.hasPointerCapture?.(event.pointerId)) {
      root.releasePointerCapture(event.pointerId);
    }

    if (!pending) {
      event.preventDefault();
    }
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

  const lostCapture = (event: PointerEvent): void => {
    if (event.target === root) {
      cancel();
    }
  };

  const nativeMove = (event: TouchEvent): void => {
    if (
      phoneTouch?.getSnapshot().matches("held") === true &&
      actor.getSnapshot().matches("dragging") &&
      event.touches.length === 1 &&
      event.cancelable
    ) {
      event.preventDefault();
    }
  };

  const contextMenu = (event: MouseEvent): void => {
    if (
      phoneTouch?.getSnapshot().matches("held") === true &&
      actor.getSnapshot().matches("dragging")
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const releaseSurfaces = bindTouchSurfaces(root, nativeMove);

  root.addEventListener("contextmenu", contextMenu, true);
  root.addEventListener("pointerdown", down);
  root.addEventListener("lostpointercapture", lostCapture);
  window.addEventListener("pagehide", cancel);
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
    releaseHold();
    releaseSurfaces();
    root.removeEventListener("contextmenu", contextMenu, true);
    root.removeEventListener("pointerdown", down);
    root.removeEventListener("lostpointercapture", lostCapture);
    window.removeEventListener("pagehide", cancel);
    window.removeEventListener("click", click, true);
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", cancel);
    window.removeEventListener("keydown", key, true);
  };
};
