import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { aboutCommandFixture } from "./about-command-fixture.js";
import {
  aboutCommandProof,
  executeAboutProofWithStandInBoxes,
} from "./about-command-proof.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

for (const shell of ["mac", "web"] as const) {
  for (const size of [
    { theme: "light", width: 1440 },
    { theme: "dark", width: 900 },
  ] as const) {
    it.effect(
      `exports actual ${shell} About command menu at ${size.width} ${size.theme}`,
      () =>
        Effect.gen(function* aboutExport() {
          const base = aboutCommandFixture(shell, size.theme);

          const model = {
            ...base,
            calendar: {
              ...base.calendar,
              viewport: 755,
              viewportWidth: size.width - 245,
            },
          };

          const rendered = yield* renderToString(
            { init: () => ({ model }), view },
            { isHydratable: false }
          );

          const fs = yield* FileSystem.FileSystem;
          const css = yield* fs.readFileString("src/client/style.css");
          const metadata = { shell, ...size };
          const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="fixture-viewport" content="${size.width}x900"><title>${shell} About command menu</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="about-command-evidence">${JSON.stringify(metadata)}</script><script data-about-command-proof>${aboutCommandProof}</script></body></html>`;
          const document = new DOMParser().parseFromString(html, "text/html");
          executeAboutProofWithStandInBoxes(document, size.width);
          expect(document.documentElement.dataset.aboutCommandProof).toBe(
            "pass"
          );
          expect(
            document
              .querySelector("#keyboard-command-dialog")
              ?.hasAttribute("open")
          ).toBe(true);

          if (shell === "mac") {
            const tampered = new DOMParser().parseFromString(html, "text/html");
            const evidence = tampered.querySelector("#about-command-evidence");

            if (evidence === null) {
              throw new Error("Missing About scene evidence");
            }

            evidence.textContent = JSON.stringify({
              ...metadata,
              shell: "web",
            });
            expect(() => {
              executeAboutProofWithStandInBoxes(tampered, size.width);
            }).toThrow("Web or legacy command menu offered About");
          }

          const path = `../../.git/desktop-about-${shell}-${size.theme}-${size.width}-fixture.html`;
          yield* publishFixtureArtifact(path, html);
          expect(yield* fs.readFileString(path)).toBe(html);
        }).pipe(Effect.provide(NodeServices.layer))
    );
  }
}
