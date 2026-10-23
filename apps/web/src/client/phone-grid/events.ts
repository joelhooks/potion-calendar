import type { EffectActor } from "@xstate/effect";

import type { phoneTouchMachine } from "./machine.js";

const point = (event: PointerEvent) => ({
  pointerId: event.pointerId,
  x: event.clientX,
  y: event.clientY,
});

export const bindPhoneTouch = (input: {
  readonly actor: EffectActor<typeof phoneTouchMachine>;
  readonly cancelGesture?: () => void;
  readonly consumeGestureClick?: () => void;
  readonly root: HTMLElement;
  readonly navigate: (hostKey: string, direction: -1 | 1) => void;
  readonly resolveTarget?: (event: PointerEvent) => Element | undefined;
}): (() => void) => {
  const { actor, root } = input;
  let delivered = 0;
  let activePointer: number | undefined;
  const style = root.ownerDocument.createElement("style");
  style.dataset.gridTouchPan = "true";
  style.textContent =
    "@media (any-pointer: coarse) { #gesture-host, #gesture-host .calendar-view, #gesture-host .day-column, #gesture-host .all-day-cell, #gesture-host .month-cell, #gesture-host .event-chip { touch-action: pan-y pinch-zoom; } }";

  const coarse = root.ownerDocument.defaultView?.matchMedia?.(
    "(any-pointer: coarse)"
  );

  const updatePan = (): void => {
    if (coarse?.matches === true) {
      root.ownerDocument.head.append(style);
    } else {
      style.remove();
    }
  };

  updatePan();
  coarse?.addEventListener("change", updatePan);

  const subscription = actor.subscribe((snapshot) => {
    if (
      root.dataset.touchPhase !== undefined ||
      snapshot.context.start !== undefined
    ) {
      root.dataset.touchPhase = snapshot.value;
    }

    const { navigation, start } = snapshot.context;

    if (
      start !== undefined &&
      start.pointerId === activePointer &&
      (snapshot.matches("swiping") || snapshot.matches("held")) &&
      !root.hasPointerCapture?.(start.pointerId)
    ) {
      root.setPointerCapture?.(start.pointerId);
    }

    if (navigation !== undefined && navigation.id > delivered) {
      delivered = navigation.id;

      if (root.dataset.phonePeriod === navigation.hostKey) {
        input.navigate(navigation.hostKey, navigation.direction);
      }
    }
  });

  const cancel = (): void => {
    const id = actor.getSnapshot().context.start?.pointerId ?? activePointer;
    activePointer = undefined;
    input.cancelGesture?.();
    actor.send({ type: "CANCEL" });

    if (id !== undefined && root.hasPointerCapture?.(id)) {
      root.releasePointerCapture(id);
    }
  };

  const current = (event: PointerEvent): boolean => {
    const { start } = actor.getSnapshot().context;

    if (start === undefined || start.pointerId !== event.pointerId) {
      return false;
    }

    if (start.hostKey !== root.dataset.phonePeriod) {
      cancel();

      return false;
    }

    return true;
  };

  const down = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") {
      return;
    }

    if (!event.isPrimary) {
      cancel();

      return;
    }

    const target = input.resolveTarget?.(event) ?? event.target;

    if (
      !(target instanceof Element) ||
      target.closest("[data-month-parked]") !== null ||
      target.closest(
        ".event-chip,.day-column,.all-day-cell,.month-cell[data-day]"
      ) === null
    ) {
      return;
    }

    if (
      target.closest(".event-chip,.month-date,.phone-month-summary") === null &&
      target.closest(
        "button,input,textarea,select,a,[contenteditable=true]"
      ) !== null
    ) {
      return;
    }

    activePointer = event.pointerId;
    const start = point(event);
    const hostKey = root.dataset.phonePeriod;
    actor.send({
      start: hostKey === undefined ? start : { ...start, hostKey },
      type: "DOWN",
    });
  };

  const move = (event: PointerEvent): void => {
    if (!current(event) && activePointer !== event.pointerId) {
      return;
    }

    actor.send({ point: point(event), type: "MOVE" });

    if (
      actor.getSnapshot().matches("swiping") ||
      actor.getSnapshot().matches("held")
    ) {
      event.preventDefault();
    }
  };

  const up = (event: PointerEvent): void => {
    const owned = activePointer === event.pointerId;
    const held = actor.getSnapshot().matches("held");

    if (owned) {
      activePointer = undefined;
    }

    if (!current(event) && !owned) {
      return;
    }

    actor.send({ point: point(event), type: "UP" });

    if (actor.getSnapshot().context.blockClick) {
      event.preventDefault();
    }

    if (!held && root.hasPointerCapture?.(event.pointerId)) {
      root.releasePointerCapture(event.pointerId);
    }
  };

  const pointerCancel = (event: PointerEvent): void => {
    if (
      actor.getSnapshot().context.start?.pointerId === event.pointerId ||
      activePointer === event.pointerId
    ) {
      cancel();
    }
  };

  const lostCapture = (event: PointerEvent): void => {
    if (event.target === root) {
      pointerCancel(event);
    }
  };

  const click = (event: MouseEvent): void => {
    if (!(event.target instanceof Node) || !root.contains(event.target)) {
      return;
    }

    if (actor.getSnapshot().context.blockClick) {
      input.consumeGestureClick?.();
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    actor.send({ type: "CLICK" });
  };

  const key = (event: KeyboardEvent): void => {
    if (
      event.key === "Escape" &&
      actor.getSnapshot().context.start !== undefined
    ) {
      cancel();
    }
  };

  root.addEventListener("pointerdown", down);
  root.addEventListener("lostpointercapture", lostCapture);
  window.addEventListener("pointermove", move, {
    capture: true,
    passive: false,
  });
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", pointerCancel);
  window.addEventListener("blur", cancel);
  window.addEventListener("pagehide", cancel);
  window.addEventListener("keydown", key, true);
  window.addEventListener("click", click, true);

  return () => {
    cancel();
    subscription.unsubscribe();
    style.remove();
    coarse?.removeEventListener("change", updatePan);
    Reflect.deleteProperty(root.dataset, "touchPhase");
    root.removeEventListener("pointerdown", down);
    root.removeEventListener("lostpointercapture", lostCapture);
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", pointerCancel);
    window.removeEventListener("blur", cancel);
    window.removeEventListener("pagehide", cancel);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("click", click, true);
  };
};
