import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { phoneShellFixture, phoneShellScenes } from "./phone-shell-fixture.js";
import { phoneShellProofScript } from "./phone-shell-proof.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

it.effect(
  "exports eight phone shells with actual viewport model widths and no side-column projection",
  () =>
    Effect.gen(function* phoneExports() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      const directory = "../../.rat/phone-shell/ui";
      yield* fs.makeDirectory(directory, { recursive: true });

      for (const scene of phoneShellScenes) {
        const model = phoneShellFixture(
          scene.width,
          scene.height,
          scene.mode,
          scene.theme
        );

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const root = document.createElement("div");
        root.innerHTML = rendered.html;

        expect(model.calendar.viewportWidth).toBe(scene.width);
        expect(
          root.querySelectorAll(
            ".workspace > .detail-panel, .workspace > .upcoming-panel, .workspace > .sidebar-shell"
          ).length,
          `Full grid width for ${scene.mode}`
        ).toBe(0);
        expect(root.querySelectorAll(".phone-toolbar").length).toBe(1);
        expect(root.querySelectorAll("[data-phone-shell-dialog]").length).toBe(
          scene.mode === "closed" ? 0 : 1
        );
        const evidence = { ...scene, gridWidth: model.calendar.viewportWidth };
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="fixture-viewport" content="${scene.width}x${scene.height}"><title>Phone shell ${scene.mode} ${scene.theme} ${scene.width}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="phone-shell-evidence">${JSON.stringify(evidence)}</script><script data-phone-shell-proof>${phoneShellProofScript}</script></body></html>`;
        const path = `${directory}/phone-shell-${scene.mode}-${scene.theme}-${scene.width}.html`;
        yield* publishFixtureArtifact(path, html);
        expect(yield* fs.readFileString(path)).toBe(html);
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
