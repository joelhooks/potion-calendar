import { Option, Result } from "effect";

import type { TimeGridGeometry } from "../../layout/geometry.js";
import { platformModifier } from "../keyboard/modifier.js";
import { monthGestureStart } from "../month/gesture.js";
import type { MonthGestureRefused } from "../month/gesture.js";
import { pointerPoint } from "./gesture-input.js";
import { GestureStart } from "./gesture-model.js";
import type { GestureTarget } from "./gesture-model.js";
import { touchResizeTarget } from "./touch-resize.js";

interface Input {
  readonly event: PointerEvent;
  readonly grid: TimeGridGeometry;
  readonly refused:
    | ((reason: MonthGestureRefused["reason"]) => void)
    | undefined;
  readonly root: HTMLElement;
  readonly scale: number;
  readonly targets: readonly (typeof GestureTarget.Type)[];
}

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

const startsOnSurface = (
  element: Element,
  chip: HTMLElement | null,
  touch: boolean
): boolean => {
  if (chip !== null) {
    return touch || chip.classList.contains("selected");
  }

  return (
    element.closest("button,input,select,textarea,a") === null &&
    element.closest(".day-column,.all-day-cell,.month-cell[data-day]") !== null
  );
};

const pointerOrigin = (
  root: HTMLElement,
  event: PointerEvent
):
  | {
      readonly allDay: boolean;
      readonly chip: HTMLElement | null;
      readonly edge: (typeof GestureStart.Type)["edge"];
      readonly touch: boolean;
    }
  | undefined => {
  const element = gestureElement(root, event);

  if (element === undefined) {
    return undefined;
  }

  const touch = event.pointerType === "touch";
  const resize = touch ? touchResizeTarget(root, event) : undefined;
  const chip = resize?.chip ?? element.closest<HTMLElement>(".event-chip");

  if (!startsOnSurface(element, chip, touch)) {
    return undefined;
  }

  const allDay =
    root.classList.contains("month-view") ||
    (touch && chip !== null ? chip : element).closest(".all-day") !== null;

  const handle = touch
    ? undefined
    : element.closest<HTMLElement>("[data-resize-edge]")?.dataset.resizeEdge;

  const edge =
    resize?.edge ?? (handle === "start" || handle === "end" ? handle : "body");

  return { allDay, chip, edge, touch };
};

export const pointerGestureStart = ({
  event,
  grid,
  refused,
  root,
  scale,
  targets,
}: Input): Option.Option<typeof GestureStart.Type> => {
  const origin = pointerOrigin(root, event);

  if (origin === undefined) {
    return Option.none();
  }

  const { allDay, chip, edge, touch } = origin;
  const point = pointerPoint(root, event, scale, allDay, grid);

  if (Option.isNone(point)) {
    return Option.none();
  }

  const target = targets.find((item) => item.key === chip?.dataset.eventKey);

  if (chip !== null && target === undefined) {
    return Option.none();
  }

  const start = GestureStart.make({
    allDay,
    edge,
    point: point.value,
    target: Option.fromUndefinedOr(target),
  });

  if (root.classList.contains("month-view")) {
    const month = monthGestureStart({
      edge,
      point: point.value,
      selected: touch || (chip?.classList.contains("selected") ?? false),
      target: start.target,
    });

    if (Result.isSuccess(month)) {
      return Option.some(month.success);
    }

    if (touch && month.failure.reason === "ReadOnlyEvent") {
      return Option.some(start);
    }

    refused?.(month.failure.reason);

    return Option.none();
  }

  if (
    !touch &&
    target !== undefined &&
    !target.editable &&
    !(event.altKey && edge === "body")
  ) {
    return Option.none();
  }

  return Option.some(start);
};
