export const placeTouchCorners = (root: HTMLElement): void => {
  for (const chip of root.querySelectorAll<HTMLElement>(
    ".event-chip.selected"
  )) {
    const clip = chip.closest<HTMLElement>(".day-column,.all-day-cell");

    const viewport = chip.closest<HTMLElement>(
      "#time-viewport,#month-viewport,.all-day"
    );

    if (clip === null || viewport === null) {
      continue;
    }

    const grid = clip.getBoundingClientRect();
    const frame = viewport.getBoundingClientRect();
    let left = Math.max(grid.left, frame.left + viewport.clientLeft);

    const right = Math.min(
      grid.right,
      frame.left + viewport.clientLeft + viewport.clientWidth
    );

    const top = Math.max(grid.top, frame.top + viewport.clientTop);

    const bottom = Math.min(
      grid.bottom,
      frame.top + viewport.clientTop + viewport.clientHeight
    );

    for (const label of viewport.querySelectorAll<HTMLElement>(
      ".time-labels"
    )) {
      left = Math.max(left, label.getBoundingClientRect().right);
    }

    if (right - left < 44 || bottom - top < 44) {
      continue;
    }

    const box = chip.getBoundingClientRect();

    const visible =
      box.right > left &&
      box.left < right &&
      box.bottom > top &&
      box.top < bottom;

    const placements = [
      {
        handle: chip.querySelector<HTMLElement>(
          '[data-touch-resize-edge="start"]'
        ),
        left: box.left - 37,
        top: box.top - 37,
      },
      {
        handle: chip.querySelector<HTMLElement>(
          '[data-touch-resize-edge="end"]'
        ),
        left: box.right - 7,
        top: box.bottom - 7,
      },
    ];

    for (const placement of placements) {
      const { handle } = placement;

      if (handle === null) {
        continue;
      }

      handle.toggleAttribute("data-touch-corner-hidden", !visible);

      const x =
        Math.min(Math.max(left, placement.left), right - 44) -
        box.left -
        chip.clientLeft;

      const y =
        Math.min(Math.max(top, placement.top), bottom - 44) -
        box.top -
        chip.clientTop;

      const horizontal = `${x}px`;
      const vertical = `${y}px`;

      if (handle.style.getPropertyValue("--touch-corner-left") !== horizontal) {
        handle.style.setProperty("--touch-corner-left", horizontal);
      }

      if (handle.style.getPropertyValue("--touch-corner-top") !== vertical) {
        handle.style.setProperty("--touch-corner-top", vertical);
      }
    }
  }
};

export const bindTouchSurfaces = (
  root: HTMLElement,
  nativeMove: (event: TouchEvent) => void
): (() => void) => {
  const view = root.ownerDocument.defaultView;
  const coarse = view?.matchMedia?.("(any-pointer: coarse)");
  const targets = new Set<HTMLElement>();

  const refresh = (): void => {
    const current = new Set(
      root.querySelectorAll<HTMLElement>(
        "#time-viewport,#month-viewport,.all-day"
      )
    );

    for (const target of targets) {
      if (!current.has(target)) {
        target.removeEventListener("touchmove", nativeMove, true);
        targets.delete(target);
      }
    }

    for (const target of current) {
      if (!targets.has(target)) {
        target.addEventListener("touchmove", nativeMove, {
          capture: true,
          passive: false,
        });
        targets.add(target);
      }
    }

    if (coarse?.matches === true) {
      placeTouchCorners(root);

      return;
    }

    for (const handle of root.querySelectorAll<HTMLElement>(
      ".touch-resize-target"
    )) {
      if (handle.style.getPropertyValue("--touch-corner-left") !== "") {
        handle.style.removeProperty("--touch-corner-left");
      }

      if (handle.style.getPropertyValue("--touch-corner-top") !== "") {
        handle.style.removeProperty("--touch-corner-top");
      }

      Reflect.deleteProperty(handle.dataset, "touchCornerHidden");
    }
  };

  const mutations = new MutationObserver((records) => {
    const ownPlacement = records.every(
      (record) =>
        record.type === "attributes" &&
        record.target instanceof HTMLElement &&
        record.target.matches(".touch-resize-target") &&
        record.target.style.getPropertyValue("--touch-corner-left") !== "" &&
        record.target.style.getPropertyValue("--touch-corner-top") !== ""
    );

    if (!ownPlacement) {
      refresh();
    }
  });

  const Resize = view?.ResizeObserver;
  const resize = Resize === undefined ? undefined : new Resize(refresh);
  mutations.observe(root, {
    attributeFilter: ["class", "style"],
    attributes: true,
    childList: true,
    subtree: true,
  });
  resize?.observe(root);
  root.addEventListener("scroll", refresh, true);
  view?.addEventListener("resize", refresh);
  coarse?.addEventListener("change", refresh);
  refresh();

  return () => {
    mutations.disconnect();
    resize?.disconnect();
    root.removeEventListener("scroll", refresh, true);
    view?.removeEventListener("resize", refresh);
    coarse?.removeEventListener("change", refresh);

    for (const target of targets) {
      target.removeEventListener("touchmove", nativeMove, true);
    }

    for (const handle of root.querySelectorAll<HTMLElement>(
      ".touch-resize-target"
    )) {
      handle.style.removeProperty("--touch-corner-left");
      handle.style.removeProperty("--touch-corner-top");
      Reflect.deleteProperty(handle.dataset, "touchCornerHidden");
    }
  };
};
