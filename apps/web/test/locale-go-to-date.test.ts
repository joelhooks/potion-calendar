import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Message, update } from "../src/client/app.js";
import { commandChoices } from "../src/client/keyboard/choices.js";
import { AppLanguage } from "../src/layout/app-locale.js";
import { parseGoToDate } from "../src/layout/go-to-date.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { languageFixture } from "./language-fixture.js";

const today = dayFromIso("2026-10-20");

it.effect.each([
  ["fr-FR", "5 novembre"],
  ["de-DE", "5. November"],
  ["ja-JP", "11月5日"],
  ["ko-KR", "11월5일"],
  ["th-TH", "5 พฤศจิกายน"],
] as const)("%s parses its own Intl month token in %s", ([locale, query]) =>
  Effect.sync(() => {
    expect(parseGoToDate(query, today, locale)).toBe(dayFromIso("2026-11-05"));
  })
);

it.effect(
  "French mar refuses a cross-locale month/weekday collision in the actual date menu",
  () =>
    Effect.sync(() => {
      const base = languageFixture("fr-FR", "en-US", "date");
      const { model } = update(base, Message.KeyboardQuery({ query: "mar" }));
      expect(parseGoToDate("mar", today, "fr-FR")).toBeUndefined();
      expect(parseGoToDate("mar.", today, "fr-FR")).toBeUndefined();
      expect(commandChoices(model)).toEqual([]);

      const unambiguous = update(
        model,
        Message.KeyboardQuery({ query: "mardi" })
      ).model;

      expect(commandChoices(unambiguous)).toHaveLength(1);
    })
);

it.effect(
  "saved app language wins over a conflicting browser locale in the actual Go to date command",
  () =>
    Effect.sync(() => {
      const base = languageFixture("fr-FR", "en-US", "date");

      const { model } = update(
        base,
        Message.KeyboardQuery({ query: "5 novembre" })
      );

      const choices = commandChoices(model);
      expect(
        choices,
        "saved app language wins over a conflicting browser locale"
      ).toHaveLength(1);

      const [choice] = choices;
      expect(choice?.title).toContain("novembre");
      expect(choice?.message).toEqual(
        Message.KeyboardDate({ day: dayFromIso("2026-11-05"), flash: true })
      );
    })
);

it.effect.each(AppLanguage.literals)(
  "%s preserves ISO, English relatives, bounds and blank refusal",
  (locale) =>
    Effect.sync(() => {
      expect(parseGoToDate("2026-11-05", today, locale)).toBe(
        dayFromIso("2026-11-05")
      );
      expect(parseGoToDate("in 2 days", today, locale)).toBe(today + 2);
      expect(parseGoToDate("tomorrow", today, locale)).toBe(today + 1);
      expect(parseGoToDate("2041-01-01", today, locale)).toBeUndefined();
      expect(parseGoToDate("2027-02-29", today, locale)).toBeUndefined();
      expect(parseGoToDate(" ", today, locale)).toBeUndefined();
    })
);

it.effect(
  "numeric order follows the locale rather than guessing US month first",
  () =>
    Effect.sync(() => {
      expect(parseGoToDate("5/11/2026", today, "fr-FR")).toBe(
        dayFromIso("2026-11-05")
      );
      expect(parseGoToDate("5/11/2026", today, "en-US")).toBe(
        dayFromIso("2026-05-11")
      );
      expect(parseGoToDate("2026/11/5", today, "ja-JP")).toBe(
        dayFromIso("2026-11-05")
      );
      expect(parseGoToDate("31/11/2026", today, "fr-FR")).toBeUndefined();
      expect(parseGoToDate("5 6 novembre", today, "fr-FR")).toBeUndefined();
    })
);
