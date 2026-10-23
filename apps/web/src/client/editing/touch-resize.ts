interface Corner {
  readonly chip: HTMLElement;
  readonly distance: number;
  readonly edge: "start" | "end";
}

const contains = (box: DOMRect, x: number, y: number): boolean =>
  x >= box.left && x < box.right && y >= box.top && y < box.bottom;

const cornerFor = (
  chip: HTMLElement,
  event: PointerEvent
): Corner | undefined => {
  const start = chip.querySelector<HTMLElement>(
    '[data-touch-resize-edge="start"]'
  );

  const end = chip.querySelector<HTMLElement>('[data-touch-resize-edge="end"]');

  const atStart =
    start !== null &&
    contains(start.getBoundingClientRect(), event.clientX, event.clientY);

  const atEnd =
    end !== null &&
    contains(end.getBoundingClientRect(), event.clientX, event.clientY);

  if (!atStart && !atEnd) {
    return undefined;
  }

  const box = chip.getBoundingClientRect();

  const startDistance = Math.hypot(
    event.clientX - box.left,
    event.clientY - box.top
  );

  const endDistance = Math.hypot(
    event.clientX - box.right,
    event.clientY - box.bottom
  );

  const nearestStart = startDistance <= endDistance;
  const edge = atStart && (!atEnd || nearestStart) ? "start" : "end";

  return {
    chip,
    distance: edge === "start" ? startDistance : endDistance,
    edge,
  };
};

export const touchResizeTarget = (
  root: HTMLElement,
  event: PointerEvent
): Corner | undefined => {
  const recipient =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>(
          ".event-chip,button,input,select,textarea,a,[contenteditable=true]"
        )
      : null;

  if (recipient !== null) {
    if (!recipient.matches(".event-chip.selected")) {
      return undefined;
    }

    return cornerFor(recipient, event);
  }

  let closest: Corner | undefined;

  for (const chip of root.querySelectorAll<HTMLElement>(
    ".event-chip.selected"
  )) {
    const corner = cornerFor(chip, event);

    if (
      corner !== undefined &&
      (closest === undefined || corner.distance < closest.distance)
    ) {
      closest = corner;
    }
  }

  return closest;
};
