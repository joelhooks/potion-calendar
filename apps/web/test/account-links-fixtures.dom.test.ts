import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

import { renderAccountLinks } from "./account-links-fixture.js";
import { accountLinksProof } from "./account-links-proof.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

for (const theme of ["light", "dark"] as const) {
  for (const width of [390, 430, 900, 1440]) {
    it.effect(`exports P43 conferencing ${theme} ${width} account rows`, () =>
      Effect.gen(function* accountLinkArtifact() {
        const rendered = yield* renderAccountLinks(
          "conferencing",
          width,
          theme
        );

        const root = new DOMParser().parseFromString(
          rendered.html,
          "text/html"
        );

        const links = [...root.querySelectorAll(".settings-account-link")];
        const emails = ["owner@example.test", "personal@example.test"];
        expect(links).toHaveLength(emails.length);
        expect(root.querySelector("#phone-settings-dialog") !== null).toBe(
          width <= 640
        );
        expect(root.querySelector("img")).toBeNull();

        for (const [index, link] of links.entries()) {
          expect(link.firstChild?.textContent).toBe(emails[index]);
          expect(
            link.querySelector(':scope > span[aria-hidden="true"]')?.textContent
          ).toBe(" →");
        }

        const evidence = {
          emails,
          page: "conferencing",
          presentation:
            "Actual root SSR. The native dialog and exact production strip helper run for capture; the CSS/DOM controls are not native geometry proof.",
          theme,
          width,
        };

        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="fixture-viewport" content="${width}x900"><title>P43 account links ${theme} ${width}</title><style>${rendered.css}</style></head><body>${rendered.html}<script type="application/json" id="account-links-evidence">${JSON.stringify(evidence)}</script><script type="application/json" id="account-links-geometry">{}</script><script data-account-links-proof>${accountLinksProof}</script></body></html>`;
        const fs = yield* FileSystem.FileSystem;
        const directory = "../../.rat/account-links/ui";
        yield* fs.makeDirectory(directory, { recursive: true });
        const file = `${directory}/conferencing-${theme}-${width}.html`;
        yield* publishFixtureArtifact(file, html);
        expect(yield* fs.readFileString(file)).toBe(html);
      }).pipe(Effect.provide(NodeServices.layer))
    );
  }
}
