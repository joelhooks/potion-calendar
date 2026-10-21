import { DateTime } from "effect";

const dayMillis = 86_400_000;

export const dayFromIso = (iso: string): number =>
  Math.floor(DateTime.toEpochMillis(DateTime.makeUnsafe(iso)) / dayMillis);

export const isoFromDay = (day: number): string =>
  DateTime.formatIsoDateUtc(DateTime.makeUnsafe(day * dayMillis));

export const partsFromDay = (
  day: number
): ReturnType<typeof DateTime.toPartsUtc> =>
  DateTime.toPartsUtc(DateTime.makeUnsafe(day * dayMillis));

export const dayInZone = (instant: number, zone: string): number => {
  const { year, month, day } = DateTime.toParts(
    DateTime.makeZonedUnsafe(instant, { timeZone: zone })
  );

  return dayFromIso(
    DateTime.formatIsoDateUtc(DateTime.makeUnsafe({ day, month, year }))
  );
};

export const midnightInZone = (day: number, zone: string): string =>
  DateTime.formatIso(
    DateTime.makeZonedUnsafe(`${isoFromDay(day)}T00:00:00.000Z`, {
      adjustForTimeZone: true,
      timeZone: zone,
    })
  );

const minimum = dayFromIso("2015-01-01");

const maximum = dayFromIso("2040-12-31");

export const maximumDisplayedDays = 31;

export const displayDayBounds = Object.freeze({
  end: maximum + 1,
  start: minimum,
});

export const isDisplayDay = (day: number): boolean =>
  day >= minimum && day <= maximum;

export const clampDisplayDay = (day: number): number =>
  Math.max(minimum, Math.min(maximum, day));

export const weekStart = (day: number, startsOn = 0): number =>
  day - ((partsFromDay(day).weekDay - startsOn + 7) % 7);
