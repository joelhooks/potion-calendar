import { Option } from "effect";

import { monthMetrics } from "./month-metrics.js";
import { monthWindowWeeks } from "./month-window.js";
import type { MonthWindowFrame } from "./month-window.js";
import {
  isDisplayDay,
  monthHidesWeekends,
  partsFromDay,
  periodStart,
} from "./navigation.js";
import type { Navigation } from "./navigation.js";
import { weekNumber } from "./settings-week.js";

export { monthMetrics } from "./month-metrics.js";

export const monthGeometry = (height: number, showWeekNumbers: boolean) => {
  const rowHeight = Math.max(
    0,
    (height - monthMetrics.headerHeight) / monthMetrics.weekCount
  );

  return {
    chipRows: Math.max(
      0,
      Math.floor(
        (rowHeight - monthMetrics.dateHeight - monthMetrics.bottom) /
          monthMetrics.chipPitch
      )
    ),
    columnsPrefix: showWeekNumbers ? `${monthMetrics.weekGutter}px ` : "",
    rowHeight,
  };
};

export const monthWeeks = (
  navigation: Navigation,
  frame?: typeof MonthWindowFrame.Type
) => {
  const start = frame?.firstWeek ?? periodStart(navigation);
  const count = frame === undefined ? monthMetrics.weekCount : monthWindowWeeks;
  const starts = Array.from({ length: count }, (_, index) => start + index * 7);

  const pinned =
    frame === undefined ? undefined : Option.getOrUndefined(frame.pinnedWeek);

  if (pinned !== undefined && !starts.includes(pinned)) {
    starts.push(pinned);
  }

  return starts.map((first) => ({
    days: Array.from({ length: 7 }, (_, offset) => first + offset)
      .filter(
        (day) =>
          !monthHidesWeekends(navigation) ||
          (partsFromDay(day).weekDay !== 0 && partsFromDay(day).weekDay !== 6)
      )
      .map((day) => ({ day, enabled: isDisplayDay(day) })),
    number: weekNumber(first + 3),
    parked:
      frame !== undefined &&
      pinned === first &&
      (first < frame.firstWeek ||
        first >= frame.firstWeek + monthWindowWeeks * 7),
    start: first,
  }));
};
