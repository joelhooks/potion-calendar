import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import {
  Arbitrary,
  DateTime,
  Effect,
  FileSystem,
  Option,
  Schema,
  Struct,
} from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import {
  LanguageRefresh,
  SaveAppLanguage,
} from "../src/client/settings/language.js";
import {
  SettingsChange,
  normalizePreferences,
} from "../src/client/settings/model.js";
import {
  modifyPreferences,
  readPreferences,
} from "../src/client/settings/preference-storage.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import { view } from "../src/features/app.js";
import {
  AppLanguage,
  ambiguousCalendarWord,
  effectiveFormattingLocale,
  languageChoice,
  normalizedBrowserLocale,
  resolvedAppLocale,
} from "../src/layout/app-locale.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { languageFixture } from "./language-fixture.js";
import {
  executeFollowupsProofWithStandInBoxes,
  languageFollowupsProof,
} from "./language-followups-proof.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

const catalog: readonly {
  readonly label: string;
  readonly stored: typeof AppLanguage.Type;
}[] = [
  { label: "English (US)", stored: "en-US" },
  { label: "English (UK)", stored: "en-GB" },
  { label: "Korean", stored: "ko-KR" },
  { label: "Japanese", stored: "ja-JP" },
  { label: "French", stored: "fr-FR" },
  { label: "German", stored: "de-DE" },
  { label: "Spanish (Spain)", stored: "es-ES" },
  { label: "Latin American Spanish", stored: "es-LA" },
  { label: "Portuguese (Brazil)", stored: "pt-BR" },
  { label: "Finnish", stored: "fi-FI" },
  { label: "Danish", stored: "da-DK" },
  { label: "Dutch", stored: "nl-NL" },
  { label: "Norwegian", stored: "no-NO" },
  { label: "Swedish", stored: "sv-SE" },
  { label: "Indonesian", stored: "id-ID" },
  { label: "Italian", stored: "it-IT" },
  { label: "Thai", stored: "th-TH" },
  { label: "Vietnamese", stored: "vi-VN" },
  { label: "Chinese (Simplified)", stored: "zh-CN" },
  { label: "Chinese (Traditional)", stored: "zh-TW" },
];

it.effect.prop(
  "only es-LA receives a derived formatting alias; the catalog and preference keep their literal codes",
  { language: Arbitrary.schema(AppLanguage) },
  ({ language }) =>
    Effect.sync(() => {
      const preferences = normalizePreferences({
        language,
        version: 2,
        visibility: {},
      });

      expect(preferences.language).toBe(language);
      expect(languageChoice(language)).toEqual(
        Option.some(Option.some(language))
      );
      expect(effectiveFormattingLocale(language)).toBe(
        language === "es-LA" ? "es-419" : language
      );
      expect(Schema.decodeUnknownOption(AppLanguage)("es-419")).toEqual(
        Option.none()
      );
      expect(AppLanguage.literals).toHaveLength(20);
    })
);

it.effect(
  "browser es-LA receives the alias before Intl can collapse it to generic Spanish",
  () =>
    Effect.sync(() => {
      expect(normalizedBrowserLocale("es-LA")).toBe("es-419");
      expect(resolvedAppLocale({ settings: { browserLocale: "es-LA" } })).toBe(
        "es-419"
      );
      expect(
        resolvedAppLocale({
          settings: { browserLocale: "es-LA", language: "de-DE" },
        })
      ).toBe("de-DE");
      expect(ambiguousCalendarWord("mar")).toBe(true);
    })
);

it.effect(
  "the actual save command persists es-LA before refresh and reloaded preferences keep the code",
  () =>
    Effect.gen(function* preserveStoredCode() {
      const person = "p73-language-owner";
      const key = `calendar.visibility.${person}`;

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          expect(localStorage.getItem(key)).toBeNull();
        }),
        () =>
          Effect.sync(() => {
            localStorage.removeItem(key);
          })
      );

      const base = {
        ...languageFixture("en-US", "de-DE", "general"),
        person: Option.some(person),
      };

      yield* modifyPreferences(person, () => preferenceSnapshot(base));

      const changed = update(
        base,
        Message.ChangedSettings({
          change: SettingsChange.cases.Language.make({
            value: Option.some("es-LA"),
          }),
        })
      );

      expect(changed.commands?.map((command) => command.name)).toEqual([
        "SaveAppLanguage",
      ]);
      expect(changed.model).toBe(base);

      let refreshed = false;

      const result = yield* SaveAppLanguage({
        language: Option.some("es-LA"),
        person,
      }).effect.pipe(
        Effect.provideService(LanguageRefresh, {
          refresh: Effect.sync(() => {
            expect(localStorage.getItem(key)).toContain('"language":"es-LA"');
            expect(localStorage.getItem(key)).not.toContain("es-419");
            refreshed = true;
          }),
        })
      );

      expect(result).toEqual(Message.SavedPreferences());
      expect(refreshed).toBe(true);

      const preferences = yield* readPreferences(person);

      const reloaded = update(
        base,
        Message.ReceivedPreferences({ person, preferences })
      ).model;

      expect(preferences.language).toBe("es-LA");
      expect(reloaded.settings.language).toBe("es-LA");
      expect(preferenceSnapshot(reloaded).language).toBe("es-LA");
      expect(resolvedAppLocale(reloaded)).toBe("es-419");
      expect(reloaded.settings.timeFormat).toBe(base.settings.timeFormat);
      expect(reloaded.calendar.navigation.weekStartsOn).toBe(
        base.calendar.navigation.weekStartsOn
      );
    })
);

it.effect(
  "browser-default hint does not claim a stored sentinel or alias",
  () =>
    Effect.gen(function* browserHint() {
      const base = languageFixture("en-US", "es-LA", "general");

      const model = {
        ...base,
        settings: Struct.omit(base.settings, ["language"]),
      };

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const select =
        document.querySelector<HTMLSelectElement>("#settings-language");

      expect(select?.value).toBe("browser");
      expect(select?.title).toBe("Browser default");
      expect(select?.selectedOptions[0]?.textContent).toBe(
        "Use browser language"
      );
      expect(model.settings).not.toHaveProperty("language");
      expect(resolvedAppLocale(model)).toBe("es-419");
    })
);

const expectedFollowupValue = (
  scene: "general" | "editor" | "date",
  label: string
): string => {
  if (scene === "general") {
    return label;
  }

  if (scene === "editor") {
    return new Intl.DateTimeFormat("es-419", {
      calendar: "gregory",
      hour: "numeric",
      hourCycle: "h12",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(9 * 3_600_000);
  }

  return new Intl.DateTimeFormat("es-419", {
    calendar: "gregory",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
  }).format(
    DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-05T00:00:00Z"))
  );
};

for (const { label, stored } of catalog) {
  const scenes: readonly ("general" | "editor" | "date")[] =
    stored === "es-LA" ? ["general", "editor", "date"] : ["general"];

  for (const scene of scenes) {
    for (const width of [1440, 390]) {
      const name =
        scene === "editor"
          ? `saved es-LA keeps its stored code while the actual editor clock uses es-419 at ${width}`
          : `exports compact ${stored} ${scene} at ${width} with stand-in bounds; native readability is deferred`;

      it.effect(name, () =>
        Effect.gen(function* followupExport() {
          const model = languageFixture(
            stored,
            stored === "de-DE" ? "en-US" : "de-DE",
            scene,
            width
          );

          const rendered = yield* renderToString(
            { init: () => ({ model }), view },
            { isHydratable: false }
          );

          const fs = yield* FileSystem.FileSystem;
          const css = yield* fs.readFileString("src/client/style.css");

          const expected = expectedFollowupValue(scene, label);

          const metadata = {
            day: dayFromIso("2026-11-05"),
            expected,
            scene,
            stored,
            width,
          };

          const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="fixture-viewport" content="${width}x900"><title>${stored} ${scene} follow-up</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="language-followups-evidence">${JSON.stringify(metadata)}</script><script data-language-followups-proof>${languageFollowupsProof}</script></body></html>`;
          const document = new DOMParser().parseFromString(html, "text/html");

          expect(model.settings.language).toBe(stored);
          expect(preferenceSnapshot(model).language).toBe(stored);

          if (scene === "editor") {
            expect(
              document.querySelector<HTMLInputElement>("#event-startTime")
                ?.value,
              "saved es-LA keeps its stored code while the actual editor clock uses es-419"
            ).toBe(expected);
          }

          if (scene === "general") {
            const select =
              document.querySelector<HTMLSelectElement>("#settings-language");

            expect(select?.value).toBe(stored);
            expect(select?.title).toBe(`Stored code: ${stored}`);
            expect(
              [...(select?.options ?? [])]
                .slice(1)
                .map((option) => [option.value, option.textContent])
            ).toEqual(catalog.map((entry) => [entry.stored, entry.label]));
            expect(
              document.querySelectorAll('[title^="Stored code:"]')
            ).toHaveLength(1);
          }

          executeFollowupsProofWithStandInBoxes(document, width);
          expect(document.documentElement.dataset.languageFollowupsProof).toBe(
            "pass"
          );
          expect(document.documentElement.dataset.labelReadability).toBe(
            "Requires desk native readability review"
          );

          const tampered = new DOMParser().parseFromString(html, "text/html");

          const evidence = tampered.querySelector(
            "#language-followups-evidence"
          );

          if (evidence === null) {
            throw new Error("Missing follow-up evidence");
          }

          evidence.textContent = JSON.stringify({
            ...metadata,
            width: width + 1,
          });
          expect(() => {
            executeFollowupsProofWithStandInBoxes(tampered, width);
          }).toThrow("Wrong follow-up fixture width");

          const path = `../../.git/language-followups-${stored}-${scene}-${width}-fixture.html`;

          yield* publishFixtureArtifact(path, html);
          expect(yield* fs.readFileString(path)).toBe(html);
        }).pipe(Effect.provide(NodeServices.layer))
      );
    }
  }
}
