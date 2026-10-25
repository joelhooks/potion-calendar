import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { printRoute } from "../src/layout/route.js";
import { profileFixture, profileSnapshot } from "./profile-fixture.js";
import { profileProof } from "./profile-proof.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

for (const scene of [
  "pristine",
  "invalid",
  "saving",
  "failure",
  "discard",
] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [900, 1440, 390]) {
      it.effect(
        `exports P41 ${scene} ${theme} ${width} through the actual Profile root`,
        () =>
          Effect.gen(function* profileRootExport() {
            const model = profileFixture(scene, width, theme);
            const route = printRoute(model.route);
            expect(route).toBe("/settings/profile");
            expect(profileSnapshot(model).user.name).toBe("Calendar owner");
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

            expect(
              root.querySelector(".settings-content h1")?.textContent
            ).toBe("Profile");
            expect(root.querySelector(".profile-avatar")?.textContent).toBe(
              "CO"
            );
            expect(root.querySelector("img")).toBeNull();
            expect(
              root.querySelector("#profile-name")?.getAttribute("value")
            ).toBe(model.profile.draft);
            expect(root.querySelector("#phone-settings-dialog") !== null).toBe(
              width === 390
            );
            expect(root.querySelector("#profile-discard-dialog") !== null).toBe(
              scene === "discard"
            );

            const evidence = {
              draft: model.profile.draft,
              error: Option.getOrNull(model.profile.error),
              initials: "CO",
              mode: model.profile.mode,
              presentation:
                "Staged actual root. Static proof opens native dialogs for capture. Real mounts, focus, actors and history are tested separately.",
              route,
              savedName: model.profile.savedName,
              scene,
              theme,
              width,
            };

            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="fixture-viewport" content="${width}x900"><title>P41 ${scene} ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="profile-evidence">${JSON.stringify(evidence)}</script><script data-profile-proof>${profileProof}</script></body></html>`;
            const directory = "../../.rat/profile/ui";
            yield* fs.makeDirectory(directory, { recursive: true });
            const file = `${directory}/${scene}-${theme}-${width}.html`;
            yield* publishFixtureArtifact(file, html);
            expect(yield* fs.readFileString(file)).toBe(html);
          }).pipe(Effect.provide(NodeServices.layer))
      );
    }
  }
}
