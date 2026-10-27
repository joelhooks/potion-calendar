import { promptActionMenuPaddingPx } from "@calendar/core/desktop-bridge";
import type { PromptBridge } from "@calendar/core/desktop-bridge";
import { Predicate } from "effect";

export const createPromptMeasurement = (
  root: HTMLElement | null,
  api: PromptBridge | undefined
) => {
  let revision = 0;
  let frame: number | undefined;
  let menuPadding = 0;

  const measure = () => {
    if (api?.reportSize === undefined || root === null || frame !== undefined) {
      return;
    }

    frame = window.requestAnimationFrame(() => {
      frame = undefined;

      const report = {
        height: root.getBoundingClientRect().height,
        revision,
      };

      api.reportSize?.(menuPadding === 0 ? report : { ...report, menuPadding });
    });
  };

  const observer =
    !Predicate.isFunction(globalThis.ResizeObserver) ||
    root === null ||
    api?.reportSize === undefined
      ? undefined
      : new ResizeObserver(measure);

  if (root !== null) {
    observer?.observe(root);
  }

  return {
    dispose: () => {
      observer?.disconnect();

      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
        frame = undefined;
      }
    },
    menu: (open: boolean) => {
      menuPadding = open ? promptActionMenuPaddingPx : 0;
      measure();
    },
    presented: (current: number) => {
      revision = current;
      menuPadding = 0;
      measure();
    },
  };
};
