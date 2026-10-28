import { DateTime, Option } from "effect";

import { minuteInZone } from "./geometry.js";
import { dayInZone, isoFromDay } from "./navigation.js";
import { formatClock } from "./time-format.js";
import type { ResolvedTimeFormat } from "./time-format.js";
import { displayZone, zoneCity, zoneRegion } from "./time-zones.js";

export const gutterReferenceDay = (
  days: readonly number[],
  today: number
): number => (days.includes(today) ? today : (days[0] ?? today));

export const zoneClock = (
  instant: number,
  zone: string,
  format: ResolvedTimeFormat,
  locale = "en-US"
): string => formatClock(minuteInZone(instant, zone), format, locale);

export const gutterInstant = (
  day: number,
  hour: number,
  activeZone: string
): Option.Option<number> => {
  const instant = DateTime.toEpochMillis(
    DateTime.makeZonedUnsafe(
      `${isoFromDay(day)}T${String(hour).padStart(2, "0")}:00:00.000Z`,
      { adjustForTimeZone: true, timeZone: activeZone }
    )
  );

  return dayInZone(instant, activeZone) === day &&
    minuteInZone(instant, activeZone) === hour * 60
    ? Option.some(instant)
    : Option.none();
};

export const gutterClock = (
  day: number,
  hour: number,
  activeZone: string,
  zone: string,
  format: ResolvedTimeFormat,
  locale = "en-US"
): string =>
  Option.match(gutterInstant(day, hour, activeZone), {
    onNone: () => "—",
    onSome: (instant) => zoneClock(instant, zone, format, locale),
  });

export const zoneOffset = (instant: number, zone: string): string =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "longOffset",
  })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value ?? "";

export const zoneCatalog = (): readonly {
  readonly id: string;
  readonly city: string;
  readonly region: string;
}[] =>
  [
    ...new Set(
      ["UTC", ...Intl.supportedValuesOf("timeZone")].map(
        (id) => displayZone(id).id
      )
    ),
  ].map((id) => ({ city: zoneCity(id), id, region: zoneRegion(id) }));
