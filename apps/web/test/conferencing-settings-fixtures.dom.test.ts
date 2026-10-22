import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Crypto, Effect, FileSystem, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import {
  conferencingSettingsFixture,
  conferencingSettingsScenarios,
} from "./conferencing-settings-fixture.js";
import {
  conferencingSettingsProofScript,
  executeConferencingSettingsProofWithStandInBoxes,
} from "./conferencing-settings-proof.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

const fingerprint = Effect.fn("fingerprint")(function* fingerprint(
  text: string
) {
  const crypto = yield* Crypto.Crypto;

  const digest = yield* crypto.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );

  return yield* Schema.encodeEffect(Schema.Uint8ArrayFromHex)(digest);
});

it.effect(
  "exports forty deterministic actual-root conferencing settings scenes and executes the exact emitted scripts with explicit stand-in geometry",
  () =>
    Effect.gen(function* conferencingSettingsArtifacts() {
      const fs = yield* FileSystem.FileSystem;

      const css = yield* fs.readFileString("src/client/style.css");

      const manifest: {
        file: string;
        height: number;
        proofSha256: string;
        scenario: string;
        sha256: string;
        theme: string;
        width: number;
      }[] = [];

      const proofSha256 = yield* fingerprint(conferencingSettingsProofScript);

      for (const scenario of conferencingSettingsScenarios) {
        const fixture = conferencingSettingsFixture(scenario);

        for (const width of [1440, 900]) {
          for (const theme of ["light", "dark"] as const) {
            const model = {
              ...fixture.model,
              settings: { ...fixture.model.settings, theme },
            };

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const evidence = JSON.stringify(fixture.evidence).replaceAll(
              "<",
              "\\u003c"
            );

            const file = `conferencing-settings-${scenario}-${theme}-${width}-fixture.html`;

            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x960"><title>Conferencing settings ${scenario} ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="conferencing-settings-evidence">${evidence}</script><script data-conferencing-settings-proof>${conferencingSettingsProofScript}</script></body></html>`;

            const path = `../../.git/${file}`;

            yield* publishFixtureArtifact(path, html);

            const exported = yield* fs.readFileString(path);

            expect(exported).toBe(html);

            const document = executeConferencingSettingsProofWithStandInBoxes(
              exported,
              width
            );

            expect(
              document.documentElement.dataset.conferencingSettingsProof
            ).toBe("pass");

            const wrong = new DOMParser().parseFromString(
              exported,
              "text/html"
            );

            wrong
              .querySelector('.settings-nav a[href="/settings/conferencing"]')
              ?.removeAttribute("aria-current");

            expect(() =>
              executeConferencingSettingsProofWithStandInBoxes(
                wrong.documentElement.outerHTML,
                width
              )
            ).toThrow("Literal conferencing nav is not active");

            if (document.querySelector(".settings-conferencing-form")) {
              const wrongEmpty = new DOMParser().parseFromString(
                exported,
                "text/html"
              );

              const redundant = wrongEmpty.createElement("p");
              redundant.textContent = "No custom video links yet.";
              wrongEmpty.querySelector(".settings-content")?.append(redundant);
              expect(() =>
                executeConferencingSettingsProofWithStandInBoxes(
                  wrongEmpty.documentElement.outerHTML,
                  width
                )
              ).toThrow("Redundant empty-state text beside the form");
            }

            if (scenario === "save-failure" || scenario === "pending") {
              const misplaced = new DOMParser().parseFromString(
                exported,
                "text/html"
              );

              const form = misplaced.querySelector(
                ".settings-conferencing-form"
              );

              const selector =
                scenario === "save-failure"
                  ? '[role="alert"]'
                  : '[role="status"]';

              const notice = form?.querySelector(selector);

              if (form === null || notice === null || notice === undefined) {
                throw new Error("Missing form notice mutation precondition");
              }

              form.after(notice);
              expect(() =>
                executeConferencingSettingsProofWithStandInBoxes(
                  misplaced.documentElement.outerHTML,
                  width
                )
              ).toThrow(
                scenario === "save-failure"
                  ? "Save failure alert is not inside the form above its actions"
                  : "Pending status is outside the form actions"
              );
            }

            manifest.push({
              file,
              height: 960,
              proofSha256,
              scenario,
              sha256: yield* fingerprint(exported),
              theme,
              width,
            });
          }
        }
      }

      expect(manifest).toHaveLength(40);

      yield* publishFixtureArtifact(
        "../../.git/conferencing-settings-fixtures-manifest.json",
        `${JSON.stringify({ browserReview: "Pending desk capture and read; worker does not run a browser", geometry: "Node proof execution uses explicit stand-in boxes, not measured layout", scenes: manifest }, null, 2)}\n`
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
