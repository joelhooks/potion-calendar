import { Option } from "effect";

import { MonthPosition } from "../../layout/month-window.js";
import { monthDayFromText } from "./day-attribute.js";
import type { MonthRebaseRequest } from "./scroll-machine.js";

export interface MonthFocusLease {
  readonly week: number;
  readonly restore: () => boolean;
  readonly release: () => void;
}

export const retainMonthFocus = (
  viewport: HTMLElement
): Option.Option<MonthFocusLease> => {
  const document = viewport.ownerDocument;
  const element = document.activeElement;

  if (!(element instanceof HTMLElement) || !viewport.contains(element)) {
    return Option.none();
  }

  const row = element.closest<HTMLElement>(".month-week[data-week-start]");
  const week = monthDayFromText(row?.dataset.weekStart);

  if (row === null || Option.isNone(week)) {
    return Option.none();
  }

  let cancelled = false;

  const pointer = () => {
    cancelled = true;
  };

  const focus = (event: FocusEvent) => {
    if (event.target !== element) {
      cancelled = true;
    }
  };

  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("focusin", focus, true);

  return Option.some({
    release: () => {
      cancelled = true;
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("focusin", focus, true);
    },
    restore: () => {
      if (cancelled || !viewport.isConnected || !viewport.contains(element)) {
        return false;
      }

      element.focus({ preventScroll: true });

      return document.activeElement === element;
    },
    week: week.value,
  });
};

export const applyMonthRebase = (
  viewport: HTMLElement,
  request: typeof MonthRebaseRequest.Type,
  rowHeight: number
): Option.Option<typeof MonthPosition.Type> => {
  if (
    !viewport.isConnected ||
    !Option.contains(
      monthDayFromText(viewport.dataset.monthRebaseId),
      request.id
    ) ||
    !Option.contains(
      monthDayFromText(viewport.dataset.monthFirstWeek),
      request.position.firstWeek
    ) ||
    !Number.isFinite(rowHeight) ||
    rowHeight <= 0
  ) {
    return Option.none();
  }

  viewport.scrollTop = Math.max(
    0,
    viewport.scrollTop - request.rows * rowHeight
  );

  return Option.some(
    MonthPosition.make({
      firstWeek: request.position.firstWeek,
      scrollTop: viewport.scrollTop,
    })
  );
};
