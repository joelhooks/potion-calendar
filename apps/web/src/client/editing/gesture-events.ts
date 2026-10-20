import type { EffectActor } from "@xstate/effect";
import { Option } from "effect";

import { pointerPoint } from "./gesture-input.js";
import type { gestureMachine } from "./gesture-machine.js";
import type { GestureTarget } from "./gesture-model.js";

interface Input {
  readonly actor: EffectActor<typeof gestureMachine>;
  readonly root: HTMLElement;
  readonly scale: number;
  readonly getTargets: () => readonly (typeof GestureTarget.Type)[] | undefined;
}

const scrollEdge = (root: HTMLElement, event: PointerEvent): void => {
  const viewport = root.querySelector<HTMLElement>("#time-viewport");

  if (viewport === null) {
    return;
  }

  const rect = viewport.getBoundingClientRect();

  const vertical =
    event.clientY < rect.top
      ? event.clientY - rect.top
      : Math.max(0, event.clientY - rect.bottom);

  viewport.scrollTop += vertical;
};

export const bindGestureEvents = ({
  actor,
  root,
  scale,
  getTargets,
}: Input): (() => void) => {
  const down = (event: PointerEvent): void => {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      !(event.target instanceof Element)
    ) {
      return;
    }

    const targets = getTargets();

    if (targets === undefined) {
      return;
    }

    const chip = event.target.closest<HTMLElement>(".event-chip");

    if (chip !== null && !chip.classList.contains("selected")) {
      return;
    }

    if (
      chip === null &&
      event.target.closest(".day-column,.all-day-cell") === null
    ) {
      return;
    }

    const allDay = event.target.closest(".all-day") !== null;
    const point = pointerPoint(root, event, scale, allDay);

    if (Option.isNone(point)) {
      return;
    }

    const target = targets.find((item) => item.key === chip?.dataset.eventKey);

    if (chip !== null && target === undefined) {
      return;
    }

    const handle =
      event.target.closest<HTMLElement>("[data-resize-edge]")?.dataset
        .resizeEdge;

    const edge = handle === "start" || handle === "end" ? handle : "body";

    if (
      target !== undefined &&
      !target.editable &&
      !(event.altKey && edge === "body")
    ) {
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

    if (actor.getSnapshot().matches("dragging") && !start.allDay) {
      scrollEdge(root, event);
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
    if (actor.getSnapshot().context.blockClick) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    actor.send({ type: "CLICK" });
  };

  root.addEventListener("pointerdown", down);
  root.addEventListener("lostpointercapture", cancel);
  root.addEventListener("click", click, true);
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", cancel);
  window.addEventListener("keydown", key, true);

  return () => {
    cancel();
    root.removeEventListener("pointerdown", down);
    root.removeEventListener("lostpointercapture", cancel);
    root.removeEventListener("click", click, true);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", cancel);
    window.removeEventListener("keydown", key, true);
  };
};
