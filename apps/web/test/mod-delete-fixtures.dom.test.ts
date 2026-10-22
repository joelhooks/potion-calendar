import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";
import { afterEach, vi } from "vitest";

import { view } from "../src/features/app.js";
import {
  modDeleteArtifactFixture,
  modDeleteScenarios,
} from "./mod-delete-artifact-fixture.js";
import {
  executeModDeleteProofWithStandInBoxes,
  modDeleteProofScript,
} from "./mod-delete-proof.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

afterEach(() => {
  vi.restoreAllMocks();
});

it.effect(
  "exports 24 actual-root instant-delete receipts and shortcut listings, checking exact scripts with explicit stand-in boxes",
  () =>
    Effect.gen(function* exportModDelete() {
      vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const scenario of modDeleteScenarios) {
        const fixture = yield* modDeleteArtifactFixture(scenario).pipe(
          Effect.scoped
        );

        for (const width of [900, 1440]) {
          for (const theme of ["light", "dark"] as const) {
            const model = {
              ...fixture.model,
              calendar: {
                ...fixture.model.calendar,
                viewport: 844,
                viewportWidth: width - (width <= 1000 ? 185 + 260 : 220 + 300),
              },
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

            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x960"><title>${scenario} ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="mod-delete-evidence">${evidence}</script><script data-mod-delete-proof>${modDeleteProofScript}</script></body></html>`;
            const path = `../../.git/mod-delete-${scenario}-${theme}-${width}-fixture.html`;
            yield* publishFixtureArtifact(path, html);
            const exported = yield* fs.readFileString(path);
            expect(
              executeModDeleteProofWithStandInBoxes(exported, width)
                .documentElement.dataset.modDeleteProof
            ).toBe("pass");

            const wrong = exported.replace('"loaded":true', '"loaded":false');
            expect(() =>
              executeModDeleteProofWithStandInBoxes(wrong, width)
            ).toThrow("Missing loaded source precondition");
          }
        }
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
