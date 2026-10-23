import { runInNewContext } from "node:vm";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";
import {
  responseLabelFixture,
  responseLabelScenes,
} from "./rsvp-label-fixture.js";
import { responseLabelProofScript } from "./rsvp-label-proof.js";

for (const scene of responseLabelScenes) {
  it.effect(
    `exports plain RSVP participant labels ${scene.width} ${scene.theme}`,
    () =>
      Effect.gen(function* exportResponseLabels() {
        const model = responseLabelFixture(
          scene.width,
          scene.height,
          scene.theme
        );

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const fs = yield* FileSystem.FileSystem;
        const css = yield* fs.readFileString("src/client/style.css");
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="fixture-viewport" content="${scene.width}x${scene.height}"><title>P23 RSVP labels ${scene.width} ${scene.theme}</title><style>${css}</style></head><body>${rendered.html}<script data-rsvp-label-proof>${responseLabelProofScript}</script></body></html>`;
        const parsed = new DOMParser().parseFromString(html, "text/html");

        const exact = parsed.querySelector(
          "script[data-rsvp-label-proof]"
        )?.textContent;

        expect(exact).toBe(responseLabelProofScript);
        runInNewContext(exact ?? "throw new Error('Missing RSVP proof')", {
          document: parsed,
          window: { __JSDOM_STAND_IN__: true },
        });
        expect(parsed.documentElement.dataset.fixtureReady).toBe("rsvp-labels");
        expect(parsed.documentElement.dataset.rsvpLabelProof).toBe(
          "JSDOM stand-in; not browser proof"
        );

        return yield* publishFixtureArtifact(
          `../../.git/rsvp-labels-${scene.width}-${scene.theme}-fixture.html`,
          html
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );
}
