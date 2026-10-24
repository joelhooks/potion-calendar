import type { PromptBridge } from "@calendar/core/desktop-bridge";
import { Predicate } from "effect";

export const createPromptMeasurement = (
  root: HTMLElement | null,
  api: PromptBridge | undefined
) => {
  let revision = 0;
  let frame: number | undefined;

  const measure = () => {
    if (api?.reportSize === undefined || root === null || frame !== undefined) {
      return;
    }

    frame = window.requestAnimationFrame(() => {
      frame = undefined;
      api.reportSize?.({
        height: root.getBoundingClientRect().height,
        revision,
      });
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
    presented: (current: number) => {
      revision = current;
      measure();
    },
  };
};
