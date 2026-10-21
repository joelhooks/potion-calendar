import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import {
  instantArtifactFixture,
  instantScenarios,
} from "./instant-artifact-fixture.js";
import {
  executeInstantProofWithStandInBoxes,
  instantProofScript,
} from "./instant-proof.js";

it.effect(
  "exports sixteen actual-root instant-key scenes and executes each exact emitted proof with explicit stand-in geometry",
  () =>
    Effect.gen(function* instantArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const scenario of instantScenarios) {
        const fixture = yield* instantArtifactFixture(scenario).pipe(
          Effect.scoped
        );

        for (const width of [1440, 900]) {
          for (const theme of ["light", "dark"] as const) {
            const sidebar = width <= 1000 ? 185 : 220;
            const panel = width <= 1000 ? 260 : 300;

            const model = {
              ...fixture.model,
              calendar: {
                ...fixture.model.calendar,
                viewport: 844,
                viewportWidth: width - sidebar - panel,
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

            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x960"><title>${scenario} ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="instant-evidence">${evidence}</script><script data-instant-proof>${instantProofScript}</script></body></html>`;
            const path = `../../.git/instant-${scenario}-${theme}-${width}-fixture.html`;
            yield* fs.writeFileString(path, html);
            const exported = yield* fs.readFileString(path);

            const document = executeInstantProofWithStandInBoxes(
              exported,
              width
            );

            expect(document.documentElement.dataset.instantNoEmailProof).toBe(
              "pass"
            );

            const wrong = new DOMParser().parseFromString(
              exported,
              "text/html"
            );

            const precondition = wrong.querySelector("#instant-evidence");

            if (precondition === null) {
              throw new Error("Missing exported precondition evidence");
            }

            precondition.textContent = evidence.replace(
              '"loaded":true',
              '"loaded":false'
            );
            expect(() =>
              executeInstantProofWithStandInBoxes(
                wrong.documentElement.outerHTML,
                width
              )
            ).toThrow("Missing loaded source precondition");
          }
        }
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
