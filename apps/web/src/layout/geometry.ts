import { DateTime } from "effect";

import { mergeMinuteRanges } from "./time-blocks.js";
import type { MinuteRange } from "./time-blocks.js";

export const geometry = {
  allDayInitial: 25,
  dayHeader: 28,
  hiddenStrip: 24,
  hourBase: 48,
  hourMaximum: 208,
  hourMinimum: 16,
  hourStep: 8,
  zoneWidth: 46,
};

export const hourHeight = (
  zoom: number,
  viewport: number,
  allDay = 25,
  visibleMinutes = 1440
): number =>
  Math.max(
    geometry.hourMinimum,
    visibleMinutes === 0
      ? 0
      : (viewport - geometry.dayHeader - allDay) / (visibleMinutes / 60),
    Math.min(geometry.hourMaximum, geometry.hourBase + zoom * geometry.hourStep)
  );

export const timeColumns = (available: number, days: number) => {
  const day = Math.max(
    16,
    Math.ceil((available - geometry.zoneWidth) / Math.max(1, days))
  );

  return {
    day,
    template: `46px repeat(${days}, ${day}px)`,
    total: geometry.zoneWidth + days * day,
  };
};

export const minuteInZone = (instant: number, zone: string): number => {
  const parts = DateTime.toParts(
    DateTime.makeZonedUnsafe(instant, { timeZone: zone })
  );

  return parts.hour * 60 + parts.minute + parts.second / 60;
};

export const timeTop = (minute: number, scale: number): number =>
  (minute * scale) / 60;

export interface TimeSegment {
  readonly endMinute: number;
  readonly height: number;
  readonly hidden: boolean;
  readonly startMinute: number;
  readonly top: number;
}

export interface TimeGridGeometry {
  readonly scale: number;
  readonly height: number;
  readonly hidden: readonly (typeof MinuteRange.Type)[];
  readonly segments: readonly TimeSegment[];
  readonly visibleMinutes: number;
}

export const gridGeometry = (
  scale: number,
  hidden: readonly (typeof MinuteRange.Type)[] = []
): TimeGridGeometry => {
  const ranges = mergeMinuteRanges(hidden);

  if (ranges.length === 0) {
    return {
      height: 24 * scale,
      hidden: ranges,
      scale,
      segments: [
        {
          endMinute: 1440,
          height: 24 * scale,
          hidden: false,
          startMinute: 0,
          top: 0,
        },
      ],
      visibleMinutes: 1440,
    };
  }

  const segments: TimeSegment[] = [];
  let minute = 0;
  let top = 0;
  let hiddenMinutes = 0;

  for (const range of ranges) {
    if (range.startMinute > minute) {
      const height = timeTop(range.startMinute - minute, scale);
      segments.push({
        endMinute: range.startMinute,
        height,
        hidden: false,
        startMinute: minute,
        top,
      });
      top += height;
    }

    segments.push({
      endMinute: range.endMinute,
      height: geometry.hiddenStrip,
      hidden: true,
      startMinute: range.startMinute,
      top,
    });
    top += geometry.hiddenStrip;
    hiddenMinutes += range.endMinute - range.startMinute;
    minute = range.endMinute;
  }

  if (minute < 1440) {
    const height = timeTop(1440 - minute, scale);
    segments.push({
      endMinute: 1440,
      height,
      hidden: false,
      startMinute: minute,
      top,
    });
    top += height;
  }

  return {
    height: top,
    hidden: ranges,
    scale,
    segments,
    visibleMinutes: 1440 - hiddenMinutes,
  };
};

export const minuteToY = (grid: TimeGridGeometry, minute: number): number => {
  const value = Math.max(0, Math.min(1440, minute));

  if (grid.hidden.length === 0) {
    return timeTop(value, grid.scale);
  }

  for (const segment of grid.segments) {
    if (value < segment.endMinute) {
      return (
        segment.top +
        ((value - segment.startMinute) /
          (segment.endMinute - segment.startMinute)) *
          segment.height
      );
    }
  }

  return grid.height;
};

export const yToMinute = (grid: TimeGridGeometry, y: number): number => {
  const value = Math.max(0, Math.min(grid.height, y));

  if (grid.hidden.length === 0) {
    return Math.max(0, Math.min(1440, (y * 60) / grid.scale));
  }

  for (const segment of grid.segments) {
    if (value < segment.top + segment.height) {
      return (
        segment.startMinute +
        ((value - segment.top) / segment.height) *
          (segment.endMinute - segment.startMinute)
      );
    }
  }

  return 1440;
};

export const rangePixels = (
  grid: TimeGridGeometry,
  start: number,
  end: number
) => ({
  height:
    grid.hidden.length === 0
      ? timeTop(end - start, grid.scale)
      : minuteToY(grid, end) - minuteToY(grid, start),
  top: minuteToY(grid, start),
});

export const visibleTicks = (grid: TimeGridGeometry): readonly number[] =>
  Array.from({ length: 24 }, (_, hour) => hour * 60).filter(
    (minute) =>
      !grid.hidden.some(
        (range) => minute >= range.startMinute && minute < range.endMinute
      )
  );

export const initialScroll = (
  minute: number,
  scale: number,
  viewport: number,
  grid: TimeGridGeometry = gridGeometry(scale)
): number =>
  Math.max(
    0,
    Math.min(grid.height - viewport, minuteToY(grid, minute) - viewport / 3)
  );

export const nearFullDay = (
  start: number,
  end: number,
  zone: string
): boolean => {
  const localStart = DateTime.makeZonedUnsafe(start, { timeZone: zone });
  const parts = DateTime.toParts(localStart);
  const nextDay = DateTime.add(localStart, { days: 1 });

  return (
    parts.hour === 0 &&
    parts.minute === 0 &&
    parts.second === 0 &&
    end >= DateTime.toEpochMillis(nextDay) - 60_000
  );
};
