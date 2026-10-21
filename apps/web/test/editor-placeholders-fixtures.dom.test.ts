import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

import { placeholderArtifact } from "./editor-placeholders-fixture.js";
import { executePlaceholderProofWithStandIns } from "./editor-placeholders-proof.js";

const combinations = [
  [1440, "light"],
  [1440, "dark"],
  [900, "light"],
  [900, "dark"],
] as const;

it.effect.each(combinations)(
  "exports both ordinary empty editor contexts at %s in %s with exact proof scripts",
  ([width, theme]) =>
    Effect.gen(function* placeholderArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const kind of ["create", "edit"] as const) {
        const html = yield* placeholderArtifact(kind, width, theme, css);
        const proof = executePlaceholderProofWithStandIns(html, width, theme);
        expect(proof.documentElement.dataset.fixtureReady).toBe(
          "editor-placeholders"
        );
        expect(() =>
          executePlaceholderProofWithStandIns(
            html.replace('"loaded":true', '"loaded":false'),
            width,
            theme
          )
        ).toThrow("Missing loaded person/calendar precondition");
        expect(() =>
          executePlaceholderProofWithStandIns(
            html
              .replace("--muted: #5b675f;", "--muted: #fff;")
              .replace("--muted: #b0beb5;", "--muted: #171c19;"),
            width,
            theme
          )
        ).toThrow("Placeholder contrast below 4.5:1");
        expect(() =>
          executePlaceholderProofWithStandIns(html, width, theme, true)
        ).toThrow("Field outside dialog event-description");
        expect(() =>
          executePlaceholderProofWithStandIns(html, width, theme, false, true)
        ).toThrow("Field outside editor scroll event-description");
        yield* fs.writeFileString(
          `../../.git/editor-placeholders-${kind}-${theme}-${width}-fixture.html`,
          html
        );
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
