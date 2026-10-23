import { Option } from "effect";

import type {
  GesturePoint,
  GestureResult,
  GestureStart,
  GestureTarget,
} from "../client/editing/gesture-model.js";
import {
  dragDateRange,
  dragPrecision,
  dragTimeRange,
  resizeTimeRange,
  snapMinute,
} from "./edit-time.js";
import { isoFromDay } from "./navigation.js";

const minuteOf = (absolute: number): number =>
  ((absolute % 1440) + 1440) % 1440;

const clock = (absolute: number): string => {
  const minute = minuteOf(absolute);

  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(Math.floor(minute % 60)).padStart(2, "0")}`;
};

const relativeResizeRange = (
  start: typeof GestureStart.Type,
  target: typeof GestureTarget.Type,
  point: typeof GesturePoint.Type,
  precision: ReturnType<typeof dragPrecision>
) => {
  const dates = target.allDay || start.allDay;

  const distance =
    (point.day - start.point.day) * 1440 +
    (dates ? 0 : point.minute - start.point.minute);

  const delta = dates ? distance : snapMinute(distance, precision);

  if (delta === 0) {
    return { end: target.end, start: target.start };
  }

  const minimum = target.allDay ? 1440 : precision;

  return start.edge === "start"
    ? {
        end: target.end,
        start: Math.min(target.start + delta, target.end - minimum),
      }
    : {
        end: Math.max(target.end + delta, target.start + minimum),
        start: target.start,
      };
};

const resizedGesture = (
  start: typeof GestureStart.Type,
  target: typeof GestureTarget.Type,
  point: typeof GesturePoint.Type,
  precision: ReturnType<typeof dragPrecision>
) => {
  if (start.resizeMode === "relative") {
    return relativeResizeRange(start, target, point, precision);
  }

  if (target.allDay) {
    return {
      end:
        start.edge === "end"
          ? Math.max((point.day + 1) * 1440, target.start + 1440)
          : target.end,
      start:
        start.edge === "start"
          ? Math.min(point.day * 1440, target.end - 1440)
          : target.start,
    };
  }

  const edgeMinute = minuteOf(
    start.edge === "start" ? target.start : target.end
  );

  const edgeDay =
    point.day + (start.edge === "end" && edgeMinute === 0 ? 1 : 0);

  const position = start.allDay
    ? edgeDay * 1440 + edgeMinute
    : point.day * 1440 + point.minute;

  if (start.allDay) {
    return {
      end:
        start.edge === "end"
          ? Math.max(position, target.start + precision)
          : target.end,
      start:
        start.edge === "start"
          ? Math.min(position, target.end - precision)
          : target.start,
    };
  }

  return resizeTimeRange(
    { end: target.end, start: target.start },
    start.edge === "start" ? "start" : "end",
    position,
    precision
  );
};

export const gestureRange = (
  start: typeof GestureStart.Type,
  point: typeof GesturePoint.Type,
  id: number
): typeof GestureResult.Type => {
  const precision = dragPrecision({ alt: point.alt, shift: point.shift });
  const target = Option.getOrUndefined(start.target);
  const origin = start.point.day * 1440 + start.point.minute;
  const at = point.day * 1440 + point.minute;
  let from: number;
  let to: number;
  const allDay = target?.allDay ?? start.allDay;

  if (target === undefined) {
    const selected = start.allDay
      ? dragDateRange(start.point.day, point.day)
      : dragTimeRange(origin, at, precision);

    from = start.allDay ? selected.start * 1440 : selected.start;
    to = start.allDay ? selected.end * 1440 : selected.end;
  } else if (start.edge === "body") {
    const delta = start.allDay
      ? (point.day - start.point.day) * 1440
      : at - origin;

    from =
      allDay || start.allDay
        ? target.start + delta
        : snapMinute(target.start + delta, precision);
    to = from + target.end - target.start;
  } else {
    const range = resizedGesture(start, target, point, precision);
    from = range.start;
    to = range.end;
  }

  const result: typeof GestureResult.Type = {
    allDayRow: start.allDay,
    duplicate: point.alt && target !== undefined && start.edge === "body",
    id,
    intent:
      point.mod === true &&
      target !== undefined &&
      !(point.alt && start.edge === "body")
        ? "noEmailGesture"
        : "ordinary",
    range: {
      allDay,
      endDate: isoFromDay(Math.floor(to / 1440) - (allDay ? 1 : 0)),
      endTime: clock(to),
      startDate: isoFromDay(Math.floor(from / 1440)),
      startTime: clock(from),
    },
    target: start.target,
  };

  const { intent, ...ordinary } = result;

  return intent === "noEmailGesture" ? result : ordinary;
};
