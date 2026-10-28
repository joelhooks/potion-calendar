import { DateTime, Option, Result, Schema } from "effect";

export const AppLanguage = Schema.Literals([
  "en-US",
  "en-GB",
  "ko-KR",
  "ja-JP",
  "fr-FR",
  "de-DE",
  "es-ES",
  "es-LA",
  "pt-BR",
  "fi-FI",
  "da-DK",
  "nl-NL",
  "no-NO",
  "sv-SE",
  "id-ID",
  "it-IT",
  "th-TH",
  "vi-VN",
  "zh-CN",
  "zh-TW",
]);

export const deskDefaultUiCopyLocale = "en-US";

export const deskDefaultFormattingCalendar = "gregory";

export const deskDefaultMissingBrowserLocale = "en-US";

export const deskDefaultBrowserLanguageLabel = "Use browser language";

export const deskDefaultLatinAmericanFormattingLocale = "es-419";

export const deskDefaultCompactLanguageLabels: Readonly<
  Record<typeof AppLanguage.Type, string>
> = {
  "da-DK": "Danish",
  "de-DE": "German",
  "en-GB": "English (UK)",
  "en-US": "English (US)",
  "es-ES": "Spanish (Spain)",
  "es-LA": "Latin American Spanish",
  "fi-FI": "Finnish",
  "fr-FR": "French",
  "id-ID": "Indonesian",
  "it-IT": "Italian",
  "ja-JP": "Japanese",
  "ko-KR": "Korean",
  "nl-NL": "Dutch",
  "no-NO": "Norwegian",
  "pt-BR": "Portuguese (Brazil)",
  "sv-SE": "Swedish",
  "th-TH": "Thai",
  "vi-VN": "Vietnamese",
  "zh-CN": "Chinese (Simplified)",
  "zh-TW": "Chinese (Traditional)",
};

export const effectiveFormattingLocale = (locale: string): string =>
  locale === "es-LA" ? deskDefaultLatinAmericanFormattingLocale : locale;

export interface AppLocaleSettings {
  readonly language?: typeof AppLanguage.Type;
  readonly browserLocale?: string;
}

export const normalizedBrowserLocale = (locale?: string): string => {
  if (locale === undefined) {
    return deskDefaultMissingBrowserLocale;
  }

  const resolved = Result.try(
    () =>
      Intl.DateTimeFormat(effectiveFormattingLocale(locale), {
        calendar: deskDefaultFormattingCalendar,
      }).resolvedOptions().locale
  );

  return Result.isFailure(resolved)
    ? deskDefaultMissingBrowserLocale
    : resolved.success;
};

export const resolvedAppLocale = (model: {
  readonly settings: AppLocaleSettings;
}): string =>
  effectiveFormattingLocale(
    model.settings.language ??
      normalizedBrowserLocale(model.settings.browserLocale)
  );

export const languageChoice = (value: string) =>
  value === "browser"
    ? Option.some(Option.none<typeof AppLanguage.Type>())
    : Option.map(Schema.decodeUnknownOption(AppLanguage)(value), Option.some);

export const asciiLocaleDigits = (input: string, locale: string): string => {
  let result = input.normalize("NFKC");
  const formatter = new Intl.NumberFormat(locale, { useGrouping: false });

  for (let value = 0; value < 10; value += 1) {
    result = result.replaceAll(formatter.format(value), String(value));
  }

  return result;
};

export const calendarWord = (value: string, locale: string): string =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase(locale)
    .replaceAll(/[.,]/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();

interface CalendarWord {
  readonly kind: "month" | "weekday";
  readonly value: number;
  readonly word: string;
}

export const calendarWords = (locale: string): readonly CalendarWord[] =>
  ["long", "short"].flatMap((width): readonly CalendarWord[] => {
    const month = new Intl.DateTimeFormat(locale, {
      calendar: deskDefaultFormattingCalendar,
      month: width === "long" ? "long" : "short",
      timeZone: "UTC",
    });

    const weekday = new Intl.DateTimeFormat(locale, {
      calendar: deskDefaultFormattingCalendar,
      timeZone: "UTC",
      weekday: width === "long" ? "long" : "short",
    });

    return [
      ...Array.from({ length: 12 }, (_, index): CalendarWord => ({
        kind: "month",
        value: index + 1,
        word: calendarWord(
          month.format(
            DateTime.toEpochMillis(
              DateTime.makeUnsafe(
                `2024-${String(index + 1).padStart(2, "0")}-15T00:00:00Z`
              )
            )
          ),
          locale
        ),
      })),
      ...Array.from({ length: 7 }, (_, value): CalendarWord => ({
        kind: "weekday",
        value,
        word: calendarWord(weekday.format((3 + value) * 86_400_000), locale),
      })),
    ];
  });

export const ambiguousCalendarWord = (word: string): boolean =>
  new Set(
    AppLanguage.literals.flatMap((locale) =>
      calendarWords(effectiveFormattingLocale(locale))
        .filter((entry) => entry.word === word)
        .map((entry) => `${entry.kind}:${entry.value}`)
    )
  ).size > 1;

export const localizedWeekday = (
  weekday: number,
  locale: string,
  width: "long" | "short" | "narrow" = "long"
): string =>
  new Intl.DateTimeFormat(locale, {
    calendar: deskDefaultFormattingCalendar,
    timeZone: "UTC",
    weekday: width,
  }).format((3 + weekday) * 86_400_000);
