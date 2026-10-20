import { DateTime } from "effect";

export const geometry = {
  allDayInitial: 25,
  dayHeader: 28,
  hourBase: 48,
  hourMaximum: 208,
  hourMinimum: 16,
  hourStep: 8,
  zoneWidth: 46,
};

export const hourHeight = (
  zoom: number,
  viewport: number,
  allDay = 25
): number =>
  Math.max(
    geometry.hourMinimum,
    (viewport - geometry.dayHeader - allDay) / 24,
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

export const initialScroll = (
  minute: number,
  scale: number,
  viewport: number
): number =>
  Math.max(
    0,
    Math.min(24 * scale - viewport, timeTop(minute, scale) - viewport / 3)
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
