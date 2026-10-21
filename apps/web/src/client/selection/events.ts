import type { EffectActor } from "@xstate/effect";
import { Option } from "effect";

import { rectangleSelection } from "../../layout/selection-set.js";
import type {
  SelectionBox,
  SelectionFragment,
} from "../../layout/selection-set.js";
import type { rectangleMachine } from "./machine.js";

const boxOf = (rect: DOMRect): typeof SelectionBox.Type => ({
  height: rect.height,
  left: rect.left,
  top: rect.top,
  width: rect.width,
});

const rootBounds = (root: HTMLElement) =>
  boxOf(
    (
      root.querySelector<HTMLElement>(".calendar-view") ??
      root.closest<HTMLElement>(".calendar-view") ??
      root
    ).getBoundingClientRect()
  );

const clip = (
  box: typeof SelectionBox.Type,
  bounds: typeof SelectionBox.Type
): typeof SelectionBox.Type => {
  const left = Math.max(box.left, bounds.left);
  const top = Math.max(box.top, bounds.top);

  return {
    height: Math.max(
      0,
      Math.min(box.top + box.height, bounds.top + bounds.height) - top
    ),
    left,
    top,
    width: Math.max(
      0,
      Math.min(box.left + box.width, bounds.left + bounds.width) - left
    ),
  };
};

export const visibleSelectionFragments = (
  root: HTMLElement
): readonly (typeof SelectionFragment.Type)[] => {
  const bounds = rootBounds(root);

  return [
    ...root.querySelectorAll<HTMLElement>(".event-chip[data-event-key]"),
  ].flatMap((chip) => {
    const key = chip.dataset.eventKey;

    if (key === undefined || chip.closest("[inert],[hidden]") !== null) {
      return [];
    }

    const viewport = chip.closest<HTMLElement>(
      "#time-viewport,#month-viewport,.all-day"
    );

    const clipping =
      viewport === null
        ? bounds
        : clip(boxOf(viewport.getBoundingClientRect()), bounds);

    return [...chip.getClientRects()].map((rect) => ({
      box: clip(boxOf(rect), clipping),
      key,
    }));
  });
};

export const bindSelectionEvents = (input: {
  readonly actor: EffectActor<typeof rectangleMachine>;
  readonly preview: (box: Option.Option<typeof SelectionBox.Type>) => void;
  readonly replace: (keys: readonly string[]) => void;
  readonly root: HTMLElement;
  readonly toggle: (key: string, mod: boolean, shift: boolean) => void;
}): (() => void) => {
  const { actor, root } = input;

  const mac = /Mac|iPhone|iPad/u.test(
    root.ownerDocument.defaultView?.navigator.platform ?? ""
  );

  let revision = 0;

  const subscription = actor.subscribe((snapshot) => {
    const { origin, point, click } = snapshot.context;

    if (
      snapshot.matches("dragging") &&
      origin !== undefined &&
      point !== undefined
    ) {
      if (
        snapshot.context.pointerId !== undefined &&
        !root.hasPointerCapture?.(snapshot.context.pointerId)
      ) {
        root.setPointerCapture?.(snapshot.context.pointerId);
      }

      input.preview(
        Option.some({
          height: Math.abs(point.y - origin.y),
          left: Math.min(origin.x, point.x),
          top: Math.min(origin.y, point.y),
          width: Math.abs(point.x - origin.x),
        })
      );
    } else {
      input.preview(Option.none());
    }

    if (snapshot.context.revision <= revision) {
      return;
    }

    ({ revision } = snapshot.context);

    if (
      snapshot.matches("completed") &&
      origin !== undefined &&
      point !== undefined
    ) {
      input.replace(
        rectangleSelection(
          visibleSelectionFragments(root),
          origin,
          point,
          rootBounds(root)
        )
      );
    } else if (click !== undefined) {
      input.toggle(click.key, click.mod, click.shift);
    }
  });

  const cancel = () => {
    actor.send({ type: "CANCEL" });
  };

  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      cancel();
    }
  };

  const down = (event: PointerEvent) => {
    if (!event.isPrimary) {
      return;
    }

    actor.send({ type: "RESET" });

    if (
      !event.shiftKey ||
      event.button !== 0 ||
      !event.isPrimary ||
      !(event.target instanceof Element) ||
      event.target.closest("input,textarea,select,a,[contenteditable=true]") !==
        null ||
      event.target.closest(
        ".event-chip,.day-column,.all-day-cell,.month-cell[data-day]"
      ) === null
    ) {
      return;
    }

    actor.send({
      point: { x: event.clientX, y: event.clientY },
      pointerId: event.pointerId,
      type: "DOWN",
    });
    event.stopImmediatePropagation();
    event.preventDefault();
  };

  const move = (event: PointerEvent) => {
    if (
      !event.shiftKey &&
      !actor.getSnapshot().matches("armed") &&
      !actor.getSnapshot().matches("dragging")
    ) {
      return;
    }

    actor.send({
      point: { x: event.clientX, y: event.clientY },
      pointerId: event.pointerId,
      type: "MOVE",
    });
    event.stopImmediatePropagation();
    event.preventDefault();
  };

  const up = (event: PointerEvent) => {
    if (
      !event.shiftKey &&
      !actor.getSnapshot().matches("armed") &&
      !actor.getSnapshot().matches("dragging")
    ) {
      return;
    }

    actor.send({
      point: { x: event.clientX, y: event.clientY },
      pointerId: event.pointerId,
      type: "UP",
    });

    if (root.hasPointerCapture?.(event.pointerId)) {
      root.releasePointerCapture(event.pointerId);
    }

    event.stopImmediatePropagation();
    event.preventDefault();
  };

  const click = (event: MouseEvent) => {
    const mod = mac ? event.metaKey : event.ctrlKey;

    if (
      !(event.target instanceof Element) ||
      (!event.shiftKey && !mod && !actor.getSnapshot().matches("completed"))
    ) {
      return;
    }

    const key = event.target.closest<HTMLElement>(".event-chip[data-event-key]")
      ?.dataset.eventKey;

    if (key === undefined) {
      return;
    }

    actor.send({ key, mod, shift: event.shiftKey, type: "CLICK" });
    event.stopImmediatePropagation();
    event.preventDefault();
  };

  root.ownerDocument.addEventListener("keydown", keydown, true);
  root.ownerDocument.defaultView?.addEventListener("blur", cancel);
  root.addEventListener("pointerdown", down, true);
  root.addEventListener("pointermove", move, true);
  root.addEventListener("pointerup", up, true);
  root.addEventListener("pointercancel", cancel, true);
  root.addEventListener("lostpointercapture", cancel, true);
  root.addEventListener("click", click, true);

  return () => {
    subscription.unsubscribe();
    root.ownerDocument.removeEventListener("keydown", keydown, true);
    root.ownerDocument.defaultView?.removeEventListener("blur", cancel);
    root.removeEventListener("pointerdown", down, true);
    root.removeEventListener("pointermove", move, true);
    root.removeEventListener("pointerup", up, true);
    root.removeEventListener("pointercancel", cancel, true);
    root.removeEventListener("lostpointercapture", cancel, true);
    root.removeEventListener("click", click, true);
  };
};
