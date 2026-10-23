import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { phoneTouchFixture, phoneTouchScenes } from "./phone-touch-fixture.js";
import { phoneTouchProofScript } from "./phone-touch-proof.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

it.effect(
  "exports six actual-root phone touch snapshots without claiming timed or native proof",
  () =>
    Effect.gen(function* touchExports() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      const pointerCss = yield* fs.readFileString(
        "src/client/coarse-pointer.css"
      );

      const rows = [];

      for (const scene of phoneTouchScenes) {
        const model = phoneTouchFixture(scene);
        expect(model.calendar.viewportWidth).toBe(scene.width);
        expect(model.phoneShell.viewportWidth).toBe(scene.width);

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const dom = new DOMParser().parseFromString(rendered.html, "text/html");
        expect(dom.querySelector("#gesture-host")).not.toBeNull();
        expect(dom.querySelectorAll(".day-column")).toHaveLength(1);
        expect(dom.querySelector(".phone-toolbar")).not.toBeNull();
        expect(dom.querySelector(".gesture-preview") !== null).toBe(
          scene.state === "preview"
        );

        if (scene.state === "read-only") {
          if (scene.kind === "move") {
            expect(
              dom
                .querySelector('.gesture-refusal[role="alert"]')
                ?.getAttribute("aria-label")
            ).toBe("Calendar gesture unavailable");
            expect(dom.body.textContent).toContain("Nothing was changed.");
          } else {
            expect(dom.body.textContent).toContain(
              "No writable calendar is available."
            );
          }
        }

        const file = `phone-touch-${scene.kind}-${scene.state}-${scene.theme}-${scene.width}-fixture.html`;
        const proof = phoneTouchProofScript(scene);
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="fixture-viewport" content="${scene.width}x${scene.height}"><title>Phone ${scene.kind} ${scene.state}</title><style>${css}</style><style data-pointer-hints>${pointerCss}</style></head><body>${rendered.html}<script type="application/json" id="phone-touch-evidence">${JSON.stringify({ ...scene, evidence: "Frozen actual-root state. Pressed cue is projected with the runtime DOM selector; no timed input executes here. Native geometry script requires Chromium." })}</script><script data-phone-touch-proof>${proof}</script></body></html>`;
        yield* publishFixtureArtifact(`../../.git/${file}`, html);
        rows.push({
          ...scene,
          file,
          proof: "data-phone-touch-proof",
          stateEvidence: "frozen snapshot, not timed input",
        });
      }

      expect(rows).toHaveLength(6);
      yield* publishFixtureArtifact(
        "../../.git/phone-touch-fixtures.json",
        `${JSON.stringify({ scenes: rows }, null, 2)}\n`
      );
    }).pipe(Effect.provide(NodeServices.layer))
);
