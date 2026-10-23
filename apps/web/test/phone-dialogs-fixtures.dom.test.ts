import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { phoneDialogsFixture } from "./phone-dialogs-fixture.js";
import type { PhoneDialogSurface } from "./phone-dialogs-fixture.js";
import {
  executePhoneDialogsProofWithStandIns,
  phoneDialogsProofScript,
} from "./phone-dialogs-proof.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

export const phoneDialogsScenes = [
  { height: 844, surface: "command", theme: "light", width: 390 },
  { height: 844, surface: "command", theme: "dark", width: 390 },
  { height: 844, surface: "editor", theme: "light", width: 390 },
  { height: 844, surface: "editor", theme: "dark", width: 390 },
  { height: 932, surface: "settings", theme: "light", width: 430 },
  { height: 932, surface: "settings", theme: "dark", width: 430 },
  { height: 932, surface: "search", theme: "light", width: 430 },
  { height: 932, surface: "search", theme: "dark", width: 430 },
] satisfies readonly {
  readonly surface: PhoneDialogSurface;
  readonly width: number;
  readonly height: number;
  readonly theme: "light" | "dark";
}[];

it.effect(
  "exports eight actual-root phone dialog scenes with exact scripts and labelled stand-in geometry",
  () =>
    Effect.gen(function* phoneDialogArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      const pointers = yield* fs.readFileString(
        "src/client/coarse-pointer.css"
      );

      const scenes = [];

      for (const scene of phoneDialogsScenes) {
        const model = phoneDialogsFixture(
          scene.surface,
          scene.width,
          scene.height,
          scene.theme
        );

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="fixture-viewport" content="${scene.width}x${scene.height}"><title>Phone ${scene.surface} ${scene.theme}</title><style>${css}</style><style data-pointer-hints>${pointers}</style></head><body>${rendered.html}<script type="application/json" id="phone-dialogs-evidence">${JSON.stringify(scene)}</script><script data-phone-dialogs-proof>${phoneDialogsProofScript}</script></body></html>`;
        const file = `phone-dialogs-${scene.surface}-${scene.theme}-${scene.width}-fixture.html`;
        yield* publishFixtureArtifact(`../../.git/${file}`, html);
        const actual = yield* fs.readFileString(`../../.git/${file}`);
        expect(
          executePhoneDialogsProofWithStandIns(
            actual,
            scene.width,
            scene.height
          ).documentElement.dataset.phoneDialogsProof
        ).toBe("pass");
        expect(() =>
          executePhoneDialogsProofWithStandIns(
            actual.replace(
              'id="phone-dialog-styles"',
              'id="missing-sheet-style"'
            ),
            scene.width,
            scene.height
          )
        ).toThrow("Missing phone styles");
        scenes.push({ ...scene, file });
      }

      yield* publishFixtureArtifact(
        "../../.git/phone-dialogs-fixtures-manifest.json",
        `${JSON.stringify(
          {
            geometry: "Explicit Node stand-ins, not browser layout proof",
            pointer: "coarse",
            scenes,
          },
          null,
          2
        )}\n`
      );
    }).pipe(Effect.provide(NodeServices.layer))
);
