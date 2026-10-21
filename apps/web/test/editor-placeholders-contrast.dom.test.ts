import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

import { placeholderArtifact } from "./editor-placeholders-fixture.js";
import { executePlaceholderProofWithStandIns } from "./editor-placeholders-proof.js";

it.effect.each(["light", "dark"] as const)(
  "keeps actual editor placeholder CSS opaque, muted and AA in %s without exporting artifacts",
  (theme) =>
    Effect.gen(function* placeholderContrast() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      const html = yield* placeholderArtifact("edit", 900, theme, css);
      const document = executePlaceholderProofWithStandIns(html, 900, theme);
      expect(document.documentElement.dataset.fixtureReady).toBe(
        "editor-placeholders"
      );
    }).pipe(Effect.provide(NodeServices.layer))
);
