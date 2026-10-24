import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Crypto, Effect, FileSystem, Option, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";
import {
  searchMoreFixture,
  searchMoreScenarios,
} from "./search-more-fixture.js";
import {
  executeSearchMoreProofWithStandInBoxes,
  searchMoreProofScript,
} from "./search-more-proof.js";

const mutedForwardFooter = (html: string): string => {
  const document = new DOMParser().parseFromString(html, "text/html");

  const footer = document.querySelector("[data-search-page-controls]");

  if (footer === null) {
    throw new Error("Missing actual forward footer for its negative control");
  }

  footer.removeAttribute("aria-live");

  return document.documentElement.outerHTML;
};

const fingerprint = Effect.fn("searchMoreFingerprint")(function* fingerprint(
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
  "exports sixteen actual-root forward-pagination scenes with exact scripts, negative proof controls and explicitly stand-in Node geometry",
  () =>
    Effect.gen(function* searchMoreArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      const proofSha256 = yield* fingerprint(searchMoreProofScript);

      const manifest: {
        file: string;
        scenario: string;
        theme: string;
        width: number;
        height: number;
        sha256: string;
        proofSha256: string;
      }[] = [];

      for (const scenario of searchMoreScenarios) {
        for (const width of [900, 1440]) {
          for (const theme of ["light", "dark"] as const) {
            const model = searchMoreFixture(scenario, theme);
            const response = Option.getOrThrow(model.search.response);

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const evidence = JSON.stringify({
              fixtureStorage:
                "No provider call in this deterministic root-update scene",
              geometry:
                "Worker execution uses explicit stand-in boxes; only desk Chromium supplies real layout evidence",
              parentSha: "a09a1b0e840efc6909ae76528dd7d227c6bf91ff",
              phase: model.search.phase,
              revision: model.search.revision,
              rowCount: response.results.length,
              scenario,
              width,
            }).replaceAll("<", "\\u003c");

            const file = `search-more-${scenario}-${theme}-${width}-fixture.html`;
            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="fixture-viewport" content="${width}x960"><title>Search more ${scenario}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="search-more-evidence">${evidence}</script><script data-search-more-proof>${searchMoreProofScript}</script></body></html>`;
            const path = `../../.git/${file}`;
            yield* publishFixtureArtifact(path, html);
            const exported = yield* fs.readFileString(path);
            expect(exported).toBe(html);

            const document = executeSearchMoreProofWithStandInBoxes(
              exported,
              width
            );

            expect(document.documentElement.dataset.searchMoreProof).toBe(
              "pass"
            );
            expect(() =>
              executeSearchMoreProofWithStandInBoxes(
                exported.replace(
                  "data-search-event=",
                  "data-mutated-search-event="
                ),
                width
              )
            ).toThrow("Earlier search page was lost");

            expect(() =>
              executeSearchMoreProofWithStandInBoxes(
                mutedForwardFooter(exported),
                width
              )
            ).toThrow("Search footer is not a polite status region");

            if (scenario === "partial-failure") {
              expect(() =>
                executeSearchMoreProofWithStandInBoxes(
                  exported.replace(
                    'aria-label="Retry Work (owner@example.test)"',
                    'aria-label="Retry calendar"'
                  ),
                  width
                )
              ).toThrow("Calendar retry lacks account-qualified name");
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

      expect(manifest).toHaveLength(16);
      yield* publishFixtureArtifact(
        "../../.git/search-more-fixtures-manifest.json",
        JSON.stringify(
          {
            parentSha: "a09a1b0e840efc6909ae76528dd7d227c6bf91ff",
            scenes: manifest,
          },
          null,
          2
        )
      );
    }).pipe(Effect.provide(NodeServices.layer))
);
