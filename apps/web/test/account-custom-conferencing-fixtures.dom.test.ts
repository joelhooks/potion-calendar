import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

import {
  accountCustomFixture,
  customScenes,
} from "./account-custom-conferencing-fixture.js";
import {
  accountCustomProof,
  executeAccountCustomProof,
} from "./account-custom-conferencing-proof.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

for (const scene of customScenes.literals) {
  const sizes: { readonly theme: "light" | "dark"; readonly width: number }[] =
    [
      { theme: "light", width: 390 },
      { theme: "dark", width: 1440 },
    ];

  if (scene === "removed" || scene === "failed") {
    sizes.push({ theme: "light", width: 900 });
  }

  for (const size of sizes) {
    it.effect(
      `exports account custom conferencing ${scene} ${size.theme} ${size.width} from the actual root`,
      () =>
        Effect.gen(function* exportCustomConferencing() {
          const fs = yield* FileSystem.FileSystem;

          const fixture = yield* accountCustomFixture(
            scene,
            size.width,
            size.theme
          );

          const css = yield* fs.readFileString("src/client/style.css");

          const evidence = JSON.stringify(fixture.evidence).replaceAll(
            "<",
            "\\u003c"
          );

          const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${size.width}x960"><title>Account custom conferencing ${scene}</title><style>${css}</style></head><body>${fixture.html}<script id="account-custom-evidence" type="application/json">${evidence}</script><script data-account-custom-proof>${accountCustomProof}</script></body></html>`;
          const path = `../../.git/account-custom-conferencing-${scene}-${size.theme}-${size.width}-fixture.html`;
          yield* publishFixtureArtifact(path, html);
          const exported = yield* fs.readFileString(path);
          expect(exported).toBe(html);
          expect(() => executeAccountCustomProof(exported)).not.toThrow();
          expect(
            executeAccountCustomProof(exported).documentElement.dataset
              .accountCustomProof
          ).toBe("pass");
        }).pipe(Effect.provide(NodeServices.layer))
    );
  }
}
