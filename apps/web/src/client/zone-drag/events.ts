import type { EffectActor } from "@xstate/effect";
import { Option, Schema } from "effect";

import { ZoneId } from "../../layout/time-zones.js";
import type { zoneDragMachine } from "./machine.js";

export const bindZoneDrag = ({
  actor,
  root,
}: {
  readonly actor: EffectActor<typeof zoneDragMachine>;
  readonly root: HTMLElement;
}): (() => void) => {
  let captured: number | undefined;

  const releaseCapture = () => {
    const pointerId = captured;
    captured = undefined;

    if (pointerId !== undefined && root.hasPointerCapture?.(pointerId)) {
      root.releasePointerCapture(pointerId);
    }
  };

  const subscription = actor.subscribe((snapshot) => {
    if (snapshot.matches("dragging") && Option.isSome(snapshot.context.start)) {
      if (captured === undefined) {
        captured = snapshot.context.start.value.pointerId;
        root.setPointerCapture?.(captured);
      }
    } else {
      releaseCapture();
    }
  });

  const destination = (x: number): number | undefined => {
    const { start } = actor.getSnapshot().context;

    if (Option.isNone(start)) {
      return undefined;
    }

    if (actor.getSnapshot().context.hostKey !== root.dataset.zoneDragHostKey) {
      actor.send({ type: "CANCEL" });

      return undefined;
    }

    const { ids } = actor.getSnapshot().context;

    const headers = [
      ...root.querySelectorAll<HTMLElement>(".zone-header[data-zone-id]"),
    ];

    const bounds = ids.flatMap((id) => {
      const header = headers.find((element) => element.dataset.zoneId === id);

      return header === undefined ? [] : [header.getBoundingClientRect()];
    });

    if (bounds.length !== ids.length) {
      return undefined;
    }

    const boundary = bounds.filter(
      (rect) => x >= rect.left + rect.width / 2
    ).length;

    const origin = ids.indexOf(start.value.id);

    return Math.max(
      0,
      Math.min(ids.length - 1, boundary > origin ? boundary - 1 : boundary)
    );
  };

  const down = (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      !(event.target instanceof Element)
    ) {
      return;
    }

    const configured = Schema.decodeUnknownOption(Schema.Array(ZoneId))(
      [...root.querySelectorAll<HTMLElement>("button[data-zone-drag-id]")].map(
        (element) => element.dataset.zoneDragId
      )
    );

    const hostKey = root.dataset.zoneDragHostKey;

    if (Option.isNone(configured) || hostKey === undefined) {
      return;
    }

    const ids = configured.value;

    const button = event.target.closest<HTMLElement>(
      "button[data-zone-drag-id]"
    );

    const id = ids.find((value) => value === button?.dataset.zoneDragId);

    if (id === undefined) {
      if (
        actor.getSnapshot().matches("idle") ||
        actor.getSnapshot().matches("cancelled")
      ) {
        actor.send({ type: "CLICK" });
      }

      return;
    }

    actor.send({
      hostKey,
      id,
      ids,
      pointerId: event.pointerId,
      type: "DOWN",
      x: event.clientX,
      y: event.clientY,
    });
  };

  const move = (event: PointerEvent) => {
    const index = destination(event.clientX);

    if (index === undefined) {
      return;
    }

    actor.send({
      index,
      pointerId: event.pointerId,
      type: "MOVE",
      x: event.clientX,
      y: event.clientY,
    });

    if (actor.getSnapshot().matches("dragging")) {
      event.preventDefault();
    }
  };

  const up = (event: PointerEvent) => {
    const index = destination(event.clientX);

    if (index !== undefined) {
      actor.send({
        index,
        pointerId: event.pointerId,
        type: "UP",
        x: event.clientX,
        y: event.clientY,
      });
    }
  };

  const cancel = () => {
    actor.send({ type: "CANCEL" });
  };

  const cancelledPointer = (event: PointerEvent) => {
    const { start } = actor.getSnapshot().context;

    if (Option.isSome(start) && start.value.pointerId === event.pointerId) {
      cancel();
    }
  };

  const keydown = (event: KeyboardEvent) => {
    if (
      event.key === "Escape" &&
      (actor.getSnapshot().matches("pressed") ||
        actor.getSnapshot().matches("dragging"))
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    }
  };

  const click = (event: MouseEvent) => {
    if (event.detail > 0 && actor.getSnapshot().context.blockClick) {
      event.preventDefault();
      event.stopImmediatePropagation();
      actor.send({ type: "CLICK" });
    }
  };

  root.addEventListener("pointerdown", down, true);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancelledPointer);
  root.addEventListener("lostpointercapture", cancelledPointer);
  root.addEventListener("click", click, true);
  root.ownerDocument.addEventListener("keydown", keydown, true);
  window.addEventListener("blur", cancel);

  return () => {
    subscription.unsubscribe();
    releaseCapture();
    root.removeEventListener("pointerdown", down, true);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancelledPointer);
    root.removeEventListener("lostpointercapture", cancelledPointer);
    root.removeEventListener("click", click, true);
    root.ownerDocument.removeEventListener("keydown", keydown, true);
    window.removeEventListener("blur", cancel);
  };
};
