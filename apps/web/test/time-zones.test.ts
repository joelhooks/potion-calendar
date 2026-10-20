import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import {
  TimeZoneAction,
  activeZone,
  displayedZones,
  initialTimeZones,
} from "../src/client/time-zones/model.js";
import { changeTimeZones } from "../src/client/time-zones/update.js";
import { dayFromIso, isoFromDay } from "../src/layout/navigation.js";
import {
  gutterClock,
  gutterInstant,
  gutterReferenceDay,
  zoneClock,
} from "../src/layout/time-zones-display.js";
import {
  addSecondary,
  displayZone,
  initialZonePreferences,
  normalizeZonePreferences,
  persistentZones,
  rememberZone,
  renameZone,
  zoneLabel,
} from "../src/layout/time-zones.js";

const Zone = Schema.Literals(Intl.supportedValuesOf("timeZone"));

const Instant = Schema.Int.check(
  Schema.isBetween({ maximum: 2_240_611_199_000, minimum: 1_420_070_400_000 })
);

it.effect.prop(
  "persistent zone normalization keeps three unique secondaries before the home primary",
  { ids: Schema.Array(Zone).check(Schema.isMaxLength(12)), primary: Zone },
  ({ ids, primary }) =>
    Effect.sync(() => {
      const home = initialZonePreferences(primary);

      const input = {
        ...home,
        secondary: [...ids, primary, ...ids].map((id) => displayZone(id)),
      };

      const normalized = normalizeZonePreferences(input);
      const all = persistentZones(normalized).map((zone) => zone.id);
      expect(all.length).toBeLessThanOrEqual(4);
      expect(new Set(all).size).toBe(all.length);
      expect(all.at(-1)).toBe(displayZone(primary).id);
      expect(normalizeZonePreferences(normalized)).toEqual(normalized);

      for (const id of all) {
        expect(addSecondary(normalized, displayZone(id))).toEqual(normalized);
      }
    })
);

it.effect.prop(
  "recent zone history is newest first and retains at most five unique choices",
  { ids: Schema.Array(Zone).check(Schema.isMaxLength(20)) },
  ({ ids }) =>
    Effect.sync(() => {
      let preferences = initialZonePreferences("UTC");

      for (const id of ids) {
        preferences = rememberZone(preferences, id);
      }

      const expected = [
        ...new Set(ids.toReversed().map((id) => displayZone(id).id)),
      ].slice(0, 5);

      expect(preferences.recent).toEqual(expected);
    })
);

it.effect.prop(
  "travel then home restores the exact persistent home configuration",
  { destination: Zone, home: Zone },
  ({ home, destination }) =>
    Effect.sync(() => {
      const initial = initialTimeZones(home);
      const expectedHome = { ...initial.preferences.primary };

      const expectedSecondary = initial.preferences.secondary.map((zone) => ({
        ...zone,
      }));

      const travelled = changeTimeZones(
        initial,
        TimeZoneAction.cases.Travel.make({ zone: displayZone(destination) })
      );

      expect(travelled.preferences.primary).toEqual(expectedHome);
      expect(travelled.preferences.secondary).toEqual(expectedSecondary);
      expect(activeZone(travelled)).toBe(displayZone(destination).id);

      const restored = changeTimeZones(
        travelled,
        TimeZoneAction.cases.Home.make({})
      );

      expect(activeZone(restored)).toBe(initial.preferences.primary.id);
      expect(restored.preferences.primary).toEqual(expectedHome);
      expect(restored.preferences.secondary).toEqual(expectedSecondary);
      expect(Option.isNone(restored.temporary)).toBe(true);
      expect(displayedZones(restored)).toEqual(
        persistentZones(initial.preferences)
      );
    })
);

it.effect("empty custom labels restore the identifier-derived default", () =>
  Effect.sync(() => {
    const initial = initialZonePreferences("Europe/London");
    const renamed = renameZone(initial, initial.primary.id, "  Team  ");
    expect(zoneLabel(renamed.primary)).toBe("Team");
    expect(
      zoneLabel(renameZone(renamed, initial.primary.id, "   ").primary)
    ).toBe("London");
  })
);

it.effect.prop(
  "zone clocks agree with Intl for random instants and zone pairs across DST",
  {
    first: Zone,
    format: Schema.Literals(["12", "24"]),
    instant: Instant,
    second: Zone,
  },
  ({ instant, first, second, format }) =>
    Effect.sync(() => {
      for (const zone of [first, second]) {
        const parts = new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          hourCycle: "h23",
          minute: "2-digit",
          timeZone: zone,
        }).formatToParts(instant);

        const hour = Number(parts.find((part) => part.type === "hour")?.value);

        const minute = Number(
          parts.find((part) => part.type === "minute")?.value
        );

        const expected =
          format === "24"
            ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
            : `${hour % 12 || 12}${minute === 0 ? "" : `:${String(minute).padStart(2, "0")}`}${hour < 12 ? "am" : "pm"}`;

        expect(zoneClock(instant, zone, format)).toBe(expected);
      }
    })
);

it.effect.each([
  {
    active: "America/New_York",
    first: "2026-03-02",
    secondary: "Europe/London",
    today: "2026-03-08",
  },
  {
    active: "America/New_York",
    first: "2026-03-23",
    secondary: "Europe/London",
    today: "2026-03-29",
  },
  {
    active: "America/New_York",
    first: "2026-03-23",
    secondary: "Europe/London",
    today: "2026-04-01",
  },
  {
    active: "America/New_York",
    first: "2026-10-26",
    secondary: "Europe/London",
    today: "2026-11-01",
  },
])(
  "DST-week gutters use visible today, otherwise the first visible date: %s",
  ({ active, first, secondary, today }) =>
    Effect.sync(() => {
      const start = dayFromIso(first);
      const days = Array.from({ length: 7 }, (_, index) => start + index);
      const reference = gutterReferenceDay(days, dayFromIso(today));
      expect(reference).toBe(
        days.includes(dayFromIso(today)) ? dayFromIso(today) : start
      );

      const formatter = new Intl.DateTimeFormat("en-CA", {
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23",
        minute: "2-digit",
        month: "2-digit",
        timeZone: active,
        year: "numeric",
      });

      const candidates = Array.from({ length: 193 }, (_, index) => {
        const instant = reference * 86_400_000 + (index - 48) * 15 * 60_000;
        const parts = formatter.formatToParts(instant);

        const part = (type: Intl.DateTimeFormatPartTypes) =>
          parts.find((value) => value.type === type)?.value ?? "";

        return {
          date: `${part("year")}-${part("month")}-${part("day")}`,
          hour: Number(part("hour")),
          instant,
          minute: Number(part("minute")),
        };
      });

      for (let hour = 0; hour < 24; hour += 1) {
        const expected = candidates.find(
          (candidate) =>
            candidate.date === isoFromDay(reference) &&
            candidate.hour === hour &&
            candidate.minute === 0
        );

        const instant = gutterInstant(reference, hour, active);
        expect(instant).toEqual(Option.fromNullishOr(expected?.instant));

        if (Option.isSome(instant)) {
          const parts = new Intl.DateTimeFormat("en-US", {
            hour: "2-digit",
            hourCycle: "h23",
            minute: "2-digit",
            timeZone: secondary,
          }).format(instant.value);

          expect(gutterClock(reference, hour, active, secondary, "24")).toBe(
            parts
          );
        } else {
          expect(gutterClock(reference, hour, active, secondary, "24")).toBe(
            "—"
          );
        }
      }
    })
);
