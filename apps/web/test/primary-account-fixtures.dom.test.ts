import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { primaryAccountFixture } from "./primary-account-fixture.js";
import { primaryAccountProof } from "./primary-account-proof.js";
import { profileSnapshot } from "./profile-fixture.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

for (const scene of ["one", "two", "disabled", "saving", "failure"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [900, 1440, 390]) {
      it.effect(
        `exports P45 ${scene} ${theme} ${width} through the actual Profile root`,
        () =>
          Effect.gen(function* primaryRootExport() {
            const model = primaryAccountFixture(scene, width, theme);

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const root = new DOMParser().parseFromString(
              rendered.html,
              "text/html"
            );

            const select = root.querySelector<HTMLSelectElement>(
              "#profile-primary-account"
            );

            expect(
              root.querySelector(".settings-content h1")?.textContent
            ).toBe("Profile");
            expect(root.querySelector("#phone-settings-dialog") !== null).toBe(
              width === 390
            );
            expect(select === null).toBe(scene === "one");
            expect(
              root.querySelector<HTMLInputElement>("#profile-name")?.disabled
            ).toBe(scene === "saving");
            expect(
              root.querySelector<HTMLButtonElement>(
                'form button[type="submit"]'
              )?.disabled
            ).toBe(scene !== "failure");

            if (select !== null) {
              expect(
                root.querySelector('label[for="profile-primary-account"]')
                  ?.textContent
              ).toBe("Primary account to log in");
              expect(select.options).toHaveLength(2);
              expect(select.value).toBe(
                scene === "disabled" ||
                  scene === "saving" ||
                  scene === "failure"
                  ? "personal"
                  : "work"
              );
              expect(select.disabled).toBe(scene === "saving");
              expect(select.options[1]?.disabled).toBe(scene === "disabled");
            }

            expect(profileSnapshot(model).user.primaryAccountId).toBe(
              scene === "disabled" ? "personal" : "work"
            );
            expect(Option.isSome(model.profile.error)).toBe(
              scene === "failure"
            );
            const fs = yield* FileSystem.FileSystem;
            const css = yield* fs.readFileString("src/client/style.css");

            const evidence = {
              draftPrimaryAccountId: Option.getOrNull(
                model.profile.draftPrimaryAccountId
              ),
              error: Option.getOrNull(model.profile.error),
              mode: model.profile.mode,
              presentation:
                "Staged actual root; desk native Chromium supplies geometry and modal proof. Mounted actors and actual D1 are separate tests.",
              savedPrimaryAccountId:
                profileSnapshot(model).user.primaryAccountId,
              scene,
              theme,
              width,
            };

            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="fixture-viewport" content="${width}x900"><title>P45 ${scene} ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="primary-account-evidence">${JSON.stringify(evidence)}</script><script data-primary-account-proof>${primaryAccountProof}</script></body></html>`;
            const directory = "../../.rat/primary-account/ui";
            yield* fs.makeDirectory(directory, { recursive: true });
            const path = `${directory}/${scene}-${theme}-${width}.html`;
            yield* publishFixtureArtifact(path, html);
            expect(yield* fs.readFileString(path)).toBe(html);
          }).pipe(Effect.provide(NodeServices.layer))
      );
    }
  }
}
