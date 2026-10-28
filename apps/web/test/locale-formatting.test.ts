import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { initialSettings } from "../src/client/settings/model.js";
import { orderedWeekdays } from "../src/client/settings/weekday-choices.js";
import {
  AppLanguage,
  deskDefaultFormattingCalendar,
} from "../src/layout/app-locale.js";
import { dayHeaderLabel } from "../src/layout/day-header.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { dayLabel } from "../src/layout/presentation.js";
import {
  canonicalClockInput,
  clockInputLabel,
} from "../src/layout/settings-time-input.js";
import { formatClock, resolvedTimeFormat } from "../src/layout/time-format.js";

it.effect.prop(
  "locale clocks round-trip through the real editable time boundary without changing wall time",
  {
    format: Schema.Literals(["12", "24"]),
    locale: AppLanguage,
    minute: Schema.Int.check(Schema.isBetween({ maximum: 1439, minimum: 0 })),
  },
  ({ format, locale, minute }) =>
    Effect.sync(() => {
      const canonical = formatClock(minute, "24");
      const shown = clockInputLabel(canonical, format, locale);
      expect(canonicalClockInput(shown, locale)).toBe(canonical);
      expect(clockInputLabel("24:00", format, locale)).toBe("24:00");
      expect(canonicalClockInput("not a time", locale)).toBe("not a time");

      if (locale !== "en-US") {
        expect(shown).toBe(
          new Intl.DateTimeFormat(locale, {
            calendar: deskDefaultFormattingCalendar,
            hour: "numeric",
            hourCycle: format === "12" ? "h12" : "h23",
            minute: "2-digit",
            timeZone: "UTC",
          }).format(minute * 60_000)
        );
      }
    })
);

it.effect.prop(
  "language never changes explicit clock choice, system clock observation or numeric weekday order",
  {
    locale: AppLanguage,
    start: Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 0 })),
  },
  ({ locale, start }) =>
    Effect.sync(() => {
      for (const system24Hour of [false, true]) {
        const systemFormat = system24Hour ? "24" : "12";

        for (const timeFormat of ["12", "24", "system"] as const) {
          expect(
            resolvedTimeFormat({
              settings: {
                ...initialSettings(),
                language: locale,
                system24Hour,
                timeFormat,
              },
            })
          ).toBe(timeFormat === "system" ? systemFormat : timeFormat);
        }
      }

      expect(orderedWeekdays(start, locale).map(({ value }) => value)).toEqual(
        Array.from({ length: 7 }, (_, index) => (start + index) % 7)
      );
    })
);

it.effect.each(AppLanguage.literals)(
  "%s uses Gregorian date years and width-sensitive localized weekday labels",
  (locale) =>
    Effect.sync(() => {
      for (const minute of [0, 9 * 60, 12 * 60, 23 * 60 + 59]) {
        for (const format of ["12", "24"] as const) {
          const canonical = formatClock(minute, "24");
          expect(
            canonicalClockInput(
              clockInputLabel(canonical, format, locale),
              locale
            )
          ).toBe(canonical);
        }
      }

      const day = dayFromIso("2026-11-05");

      const expected = new Intl.DateTimeFormat(locale, {
        calendar: "gregory",
        dateStyle: "full",
        timeZone: "UTC",
      }).format(day * 86_400_000);

      expect(dayLabel(day, { dateStyle: "full" }, locale)).toBe(expected);

      for (const [width, form] of [
        [31, "number"],
        [32, "initial"],
        [56, "full"],
      ] as const) {
        const header = dayHeaderLabel(day, width, locale);
        expect(header.ariaLabel).toBe(expected);
        expect(header.form).toBe(form);
      }

      if (locale === "th-TH") {
        expect(expected).toContain("2026");
        expect(expected).not.toContain("2569");
      }
    })
);

it.effect(
  "the retained en-US formatter preserves its historical day-period bytes",
  () =>
    Effect.sync(() => {
      expect(
        [0, 60, 540, 570, 720, 1439].map((minute) =>
          formatClock(minute, "12", "en-US")
        )
      ).toEqual(["12am", "1am", "9am", "9:30am", "12pm", "11:59pm"]);
      expect(formatClock(0, "24", "fr-FR")).not.toContain("24:");
    })
);
