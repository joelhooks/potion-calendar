import { expect, it } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Option, Result, Schema } from "effect";

import {
  ClipboardRange,
  ClipboardRefusalPresentation,
} from "../src/client/clipboard/model.js";
import { initialSettings } from "../src/client/settings/model.js";
import { AppLanguage, resolvedAppLocale } from "../src/layout/app-locale.js";
import {
  clipboardLocalTimeExplanation,
  shiftClipboardTimedDates,
} from "../src/layout/clipboard-time.js";
import { resolvedTimeFormat } from "../src/layout/time-format.js";
import { clipboardItem } from "./clipboard-fixture.js";

it.effect.prop(
  "Model-derived locale and clock only replace date/time insertions in the English DST refusal",
  {
    clock: Arbitrary.schema(Schema.Literals(["system", "12", "24"])),
    fold: Arbitrary.schema(Schema.Boolean),
    hour24: Arbitrary.schema(Schema.Boolean),
    language: Arbitrary.schema(AppLanguage),
  },
  ({ language, clock, hour24, fold }) =>
    Effect.sync(() => {
      const model = {
        settings: {
          ...initialSettings(),
          browserLocale: "fr-FR",
          language,
          system24Hour: hour24,
          timeFormat: clock,
        },
      };

      const presentation = {
        locale: resolvedAppLocale(model),
        timeFormat: resolvedTimeFormat(model),
      };

      const instant = DateTime.toEpochMillis(
        DateTime.makeUnsafe(
          fold ? "2026-11-01T01:30:00Z" : "2026-03-08T02:30:00Z"
        )
      );

      const effectiveLocale = language === "es-LA" ? "es-419" : language;
      const systemClock = hour24 ? "24" : "12";
      const effectiveClock = clock === "system" ? systemClock : clock;
      const hour = fold ? 1 : 2;

      const legacyClock =
        effectiveClock === "24" ? `0${hour}:30` : `${hour}:30am`;

      const expectedClock =
        effectiveLocale === "en-US"
          ? legacyClock
          : new Intl.DateTimeFormat(effectiveLocale, {
              calendar: "gregory",
              hour: "numeric",
              hourCycle: effectiveClock === "24" ? "h23" : "h12",
              minute: "2-digit",
              timeZone: "UTC",
            }).format(instant);

      const expectedDate = new Intl.DateTimeFormat(effectiveLocale, {
        calendar: "gregory",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(instant);

      const reason = fold
        ? "happens twice when clocks fall back"
        : "doesn't exist when clocks spring forward";

      expect(
        clipboardLocalTimeExplanation(
          instant,
          "America/Los_Angeles",
          "start",
          "Beta",
          presentation
        )
      ).toEqual(
        Option.some(
          `Beta would start at ${expectedClock} on ${expectedDate}, which ${reason}. Paste it somewhere else.`
        )
      );
      expect(model.settings.language).toBe(language);
    })
);

it.effect.prop(
  "localized presentation cannot admit a gap or fold or change its failure identity",
  {
    clock: Arbitrary.schema(Schema.Literals(["12", "24"])),
    fold: Arbitrary.schema(Schema.Boolean),
    locale: Arbitrary.schema(
      Schema.Literals(["en-US", "de-DE", "es-419", "th-TH", "ar-EG"])
    ),
  },
  ({ locale, clock, fold }) =>
    Effect.gen(function* refusalIdentity() {
      const item = clipboardItem();
      const sourceDate = fold ? "2026-10-01" : "2026-02-01";

      const start = DateTime.toEpochMillis(
        DateTime.makeUnsafe(
          `${sourceDate}T${fold ? "01" : "02"}:30:00-${fold ? "07" : "08"}:00`
        )
      );

      const range = ClipboardRange.cases.Timed.make({
        end: start + 45 * 60_000,
        start,
      });

      const result = yield* shiftClipboardTimedDates({
        days: fold ? 31 : 35,
        homeZone: "America/Los_Angeles",
        range,
        refusalPresentation: { locale, timeFormat: clock },
        source: item.source,
        title: "Beta",
      }).pipe(Effect.result);

      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("ambiguousTime");
        expect(result.failure.source).toEqual(item.source);
      }
    })
);

it.effect(
  "legacy context and malformed locale preserve the exact old en-US refusal",
  () =>
    Effect.sync(() => {
      const instant = DateTime.toEpochMillis(
        DateTime.makeUnsafe("2026-03-08T02:30:00Z")
      );

      const expected = Option.some(
        "Beta would start at 2:30am on Mar 8, which doesn't exist when clocks spring forward. Paste it somewhere else."
      );

      expect(
        clipboardLocalTimeExplanation(
          instant,
          "America/Los_Angeles",
          "start",
          "Beta"
        )
      ).toEqual(expected);
      expect(
        clipboardLocalTimeExplanation(
          instant,
          "America/Los_Angeles",
          "start",
          "Beta",
          { locale: "not_a_locale", timeFormat: "24" }
        )
      ).toEqual(expected);
      expect(
        Schema.decodeUnknownOption(ClipboardRefusalPresentation)({
          locale: "de-DE",
          timeFormat: "banana",
        })
      ).toEqual(Option.none());
    })
);
