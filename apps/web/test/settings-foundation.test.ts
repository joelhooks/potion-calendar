import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import {
  initialSettings,
  normalizePreferences,
  resolvedTheme,
  SavedPreferences,
  StoredPreferences,
} from "../src/client/settings/model.js";
import { formatClock, resolvedTimeFormat } from "../src/layout/time-format.js";

it.effect.prop(
  "24-hour clocks agree with Intl and never contain meridiems",
  { minute: Schema.Int.check(Schema.isBetween({ maximum: 1439, minimum: 0 })) },
  ({ minute }) =>
    Effect.sync(() => {
      const expected = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        hourCycle: "h23",
        minute: "2-digit",
        timeZone: "UTC",
      }).format(minute * 60_000);

      expect(formatClock(minute, "24")).toBe(expected);
      expect(formatClock(minute, "24")).not.toMatch(/am|pm/iu);
    })
);

it.effect(
  "legacy records gain defaults without losing person-local visibility or merge preference",
  () =>
    Effect.gen(function* legacyPreferences() {
      for (const stored of [
        { hidden: ["fixture-hidden"] },
        { hidden: [], mergeDuplicates: false },
      ]) {
        const decoded = yield* Schema.decodeEffect(StoredPreferences)(stored);

        const normalized = normalizePreferences(decoded);
        expect(normalized.visibility).toEqual(
          Object.fromEntries(stored.hidden.map((key) => [key, false]))
        );
        expect(normalized.mergeDuplicates).toBe(stored.mergeDuplicates ?? true);
        expect(normalized).toMatchObject({
          hideDeclined: false,
          hideWeekends: false,
          showWeekNumbers: false,
          theme: "auto",
          timeFormat: "system",
          todayAction: "today",
          version: 2,
          weekStartsOn: 0,
        });

        const encoded = yield* Schema.encodeEffect(
          Schema.fromJsonString(SavedPreferences)
        )(normalized);

        expect(
          yield* Schema.decodeEffect(Schema.fromJsonString(StoredPreferences))(
            encoded
          )
        ).toEqual(normalized);
      }

      for (const invalid of [
        { hidden: [], version: 2 },
        { hidden: [], theme: "sepia" },
        { hidden: [], weekStartsOn: 7 },
        { hidden: [], timeFormat: "always" },
      ]) {
        expect(
          Option.isNone(Schema.decodeUnknownOption(StoredPreferences)(invalid))
        ).toBe(true);
      }
    })
);

it.effect(
  "System time and Auto theme resolve from current browser projections while explicit choices win",
  () =>
    Effect.sync(() => {
      const settings = initialSettings();
      expect(resolvedTimeFormat({ settings })).toBe("12");
      expect(
        resolvedTimeFormat({ settings: { ...settings, system24Hour: true } })
      ).toBe("24");
      expect(
        resolvedTimeFormat({
          settings: { ...settings, system24Hour: true, timeFormat: "12" },
        })
      ).toBe("12");
      expect(resolvedTheme({ settings })).toBe("light");
      expect(
        resolvedTheme({ settings: { ...settings, systemDark: true } })
      ).toBe("dark");
      expect(
        resolvedTheme({
          settings: { ...settings, systemDark: true, theme: "light" },
        })
      ).toBe("light");
      expect(formatClock(0)).toBe("12am");
      expect(formatClock(12 * 60)).toBe("12pm");
      expect(formatClock(14 * 60 + 5)).toBe("2:05pm");
    })
);
