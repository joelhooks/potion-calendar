import { DateTime } from "effect";

import { dayInZone } from "./navigation.js";

export type DragPrecision = 5 | 15 | 60;

export interface ClockRange {
  readonly end: number;
  readonly start: number;
}

export interface PointerSample {
  readonly at: number;
  readonly x: number;
  readonly y: number;
}

export interface CreationPosition {
  readonly day: number;
  readonly minute: number;
}

export const dragPrecision = (modifiers: {
  readonly alt: boolean;
  readonly shift: boolean;
}): DragPrecision => {
  if (modifiers.shift) {
    return 60;
  }

  return modifiers.alt ? 5 : 15;
};

export const snapMinute = (minute: number, precision: DragPrecision): number =>
  Math.round(minute / precision) * precision;

export const dragTimeRange = (
  anchor: number,
  pointer: number,
  precision: DragPrecision
): ClockRange => {
  const from = snapMinute(anchor, precision);
  const to = snapMinute(pointer, precision);
  const start = Math.min(from, to);

  return { end: Math.max(start + precision, from, to), start };
};

export const resizeTimeRange = (
  range: ClockRange,
  edge: "start" | "end",
  pointer: number,
  precision: DragPrecision
): ClockRange => {
  const snapped = snapMinute(pointer, precision);

  return edge === "start"
    ? { end: range.end, start: Math.min(snapped, range.end - precision) }
    : { end: Math.max(snapped, range.start + precision), start: range.start };
};

export const doubleClick = (
  first: PointerSample,
  second: PointerSample
): boolean =>
  second.at >= first.at &&
  second.at - first.at <= 350 &&
  Math.abs(second.x - first.x) <= 5 &&
  Math.abs(second.y - first.y) <= 5;

export const creationPosition = (
  now: number,
  zone: string,
  visible: readonly number[],
  flashedDay?: number
): CreationPosition => {
  const today = dayInZone(now, zone);

  const day =
    flashedDay ?? (visible.includes(today) ? today : (visible[0] ?? today));

  const parts = DateTime.toParts(
    DateTime.makeZonedUnsafe(now, { timeZone: zone })
  );

  const minute =
    Math.ceil(
      (parts.hour * 60 +
        parts.minute +
        parts.second / 60 +
        parts.millisecond / 60_000) /
        30
    ) * 30;

  return { day: day + Math.floor(minute / 1440), minute: minute % 1440 };
};

export const dragDateRange = (anchor: number, pointer: number): ClockRange => ({
  end: Math.max(anchor, pointer) + 1,
  start: Math.min(anchor, pointer),
});
