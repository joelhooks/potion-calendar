import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Match } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { commandChoices } from "../src/client/keyboard/choices.js";
import { view } from "../src/features/app.js";
import type { AppLanguage } from "../src/layout/app-locale.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { dayLabel } from "../src/layout/presentation.js";
import { clockInputLabel } from "../src/layout/settings-time-input.js";
import { editorViewFields } from "./editor-fixture.js";
import { languageFixture } from "./language-fixture.js";
import {
  executeLanguageProofWithStandInBoxes,
  languageProof,
} from "./language-proof.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

const locales: readonly (typeof AppLanguage.Type)[] = [
  "en-US",
  "fr-FR",
  "de-DE",
  "ja-JP",
  "ko-KR",
  "th-TH",
];

for (const locale of locales) {
  for (const scene of ["general", "week", "editor", "date"] as const) {
    const widths = scene === "general" ? [1440, 430, 390] : [1440];

    for (const width of widths) {
      it.effect(
        `exports ${locale} ${scene} at ${width} through the actual app view`,
        () =>
          Effect.gen(function* localeExport() {
            const model = languageFixture(
              locale,
              locale === "en-US" ? "fr-FR" : "en-US",
              scene,
              width
            );

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const fs = yield* FileSystem.FileSystem;
            const css = yield* fs.readFileString("src/client/style.css");

            const expected = Match.value(scene).pipe(
              Match.when("editor", () =>
                clockInputLabel(editorViewFields.draft.startTime, "12", locale)
              ),
              Match.when("date", () => commandChoices(model)[0]?.title),
              Match.orElse(() =>
                dayLabel(
                  model.calendar.navigation.anchor,
                  { month: "long", year: "numeric" },
                  locale
                )
              )
            );

            const metadata = {
              day: dayFromIso("2026-11-05"),
              expected,
              locale,
              scene,
              width,
            };

            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="fixture-viewport" content="${width}x900"><title>${locale} ${scene}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="app-language-evidence">${JSON.stringify(metadata)}</script><script data-app-language-proof>${languageProof}</script></body></html>`;
            const document = new DOMParser().parseFromString(html, "text/html");
            executeLanguageProofWithStandInBoxes(document, width);
            expect(document.documentElement.dataset.appLanguageProof).toBe(
              "pass"
            );
            const tampered = new DOMParser().parseFromString(html, "text/html");
            const evidence = tampered.querySelector("#app-language-evidence");

            if (evidence === null) {
              throw new Error("Missing locale evidence");
            }

            evidence.textContent = JSON.stringify({
              ...metadata,
              width: width + 1,
            });
            expect(() => {
              executeLanguageProofWithStandInBoxes(tampered, width);
            }).toThrow("Wrong locale fixture width");
            const path = `../../.git/app-language-${locale}-${scene}-${width}-fixture.html`;
            yield* publishFixtureArtifact(path, html);
            expect(yield* fs.readFileString(path)).toBe(html);
          }).pipe(Effect.provide(NodeServices.layer))
      );
    }
  }
}
