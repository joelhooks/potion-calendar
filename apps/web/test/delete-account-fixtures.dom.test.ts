import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { printRoute } from "../src/layout/route.js";
import { deleteAccountFixture } from "./delete-account-fixture.js";
import { deleteAccountProof } from "./delete-account-proof.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

for (const scene of ["section", "confirming", "deleting", "failure"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [900, 1440, 390]) {
      it.effect(
        `exports P44 ${scene} ${theme} ${width} from the actual Profile root`,
        () =>
          Effect.gen(function* deletionFixtureExport() {
            const model = deleteAccountFixture(scene, width, theme);
            expect(printRoute(model.route)).toBe("/settings/profile");
            const fs = yield* FileSystem.FileSystem;
            const css = yield* fs.readFileString("src/client/style.css");

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const root = new DOMParser().parseFromString(
              rendered.html,
              "text/html"
            );

            const open = root.querySelector("#delete-account-open");
            expect(open?.textContent).toBe("Delete account…");
            expect(open?.closest("form")).toBeNull();
            expect(root.querySelector("#delete-account-dialog") !== null).toBe(
              scene !== "section"
            );
            expect(root.querySelector("#phone-settings-dialog") !== null).toBe(
              width === 390
            );
            expect(
              root.querySelector("#delete-account-error")?.textContent ?? null
            ).toBe(Option.getOrNull(model.accountDeletion.error));

            const evidence = {
              mode: model.accountDeletion.mode,
              presentation:
                "Staged actual root. Static proof opens native dialogs for capture. Actual mounts, commands, cancellation, session changes and transport are tested separately; this fixture does not run deletion.",
              route: printRoute(model.route),
              scene,
              theme,
              width,
            };

            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="fixture-viewport" content="${width}x900"><title>P44 ${scene} ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="delete-account-evidence">${JSON.stringify(evidence)}</script><script type="application/json" id="delete-account-geometry">{}</script><script data-delete-account-proof>${deleteAccountProof}</script></body></html>`;
            const directory = "../../.rat/delete-account/ui";
            yield* fs.makeDirectory(directory, { recursive: true });
            const file = `${directory}/${scene}-${theme}-${width}.html`;
            yield* publishFixtureArtifact(file, html);
            expect(yield* fs.readFileString(file)).toBe(html);
          }).pipe(Effect.provide(NodeServices.layer))
      );
    }
  }
}
