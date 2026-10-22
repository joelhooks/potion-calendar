import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { creatorFixture } from "./creator-fixture.js";
import {
  creatorProofScript,
  executeCreatorProofWithStandIns,
} from "./creator-proof.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

it.effect(
  "exports eight actual-root creator scenes with exact scripts and labelled stand-in geometry",
  () =>
    Effect.gen(function* creatorRootArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const scene of ["attendee", "non-attendee"] as const) {
        for (const width of [900, 1440]) {
          for (const theme of ["light", "dark"] as const) {
            const base = creatorFixture(scene);

            const model = {
              ...base,
              calendar: {
                ...base.calendar,
                viewport: 900,
                viewportWidth: width - (width <= 1000 ? 445 : 520),
              },
              settings: { ...base.settings, theme },
            };

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x960"><title>Creator ${scene} ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="creator-evidence">${JSON.stringify({ scene })}</script><script data-creator-proof>${creatorProofScript}</script></body></html>`;
            const file = `../../.git/creator-${scene}-${theme}-${width}-fixture.html`;
            yield* publishFixtureArtifact(file, html);
            const actual = yield* fs.readFileString(file);
            expect(
              executeCreatorProofWithStandIns(actual, width).documentElement
                .dataset.creatorProof
            ).toBe("pass");

            const broken = actual.replace(
              scene === "attendee"
                ? " · You · Creator · Optional"
                : "Created by Drew Morgan",
              "broken identity"
            );

            expect(() =>
              executeCreatorProofWithStandIns(broken, width)
            ).toThrow(
              scene === "attendee"
                ? "Creator attendee"
                : "Missing or duplicate creator byline"
            );
          }
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
