import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { commandCatalogFixture } from "./command-catalog-fixture.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

const proof = String.raw`
(() => {
  const requireFact = (ok, message) => { if (!ok) throw Error(message); };
  const evidence = JSON.parse(document.querySelector('#command-catalog-evidence').textContent);
  const dialog = document.querySelector('#keyboard-command-dialog');
  requireFact(dialog, 'Command dialog is missing');
  dialog.showModal();
  requestAnimationFrame(() => {
    requireFact(innerWidth === 900 && innerHeight === 900, 'Unexpected catalog viewport');
    requireFact(document.documentElement.scrollWidth <= innerWidth, 'Catalog widened the viewport');
    requireFact(dialog.open && dialog.matches(':modal'), 'Catalog is not a native modal');
    requireFact(document.querySelector('#keyboard-query').value === 'menu-bar', 'Catalog query changed');
    const entry = document.querySelector('#command-desktop-menu-bar');
    if (evidence.native) {
      requireFact(entry && !entry.disabled, 'Desktop toggle is missing or disabled');
      requireFact(entry.textContent.includes('menu-bar calendar'), 'Desktop toggle lost its menu-bar label');
      const box = entry.getBoundingClientRect();
      requireFact(box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, 'Desktop command is clipped');
    } else {
      requireFact(!entry, 'Desktop-only command leaked into the browser catalog');
      requireFact(!document.querySelector('#desktop-menu-bar'), 'Browser received a native settings control');
    }
    document.documentElement.dataset.commandCatalogProof = 'pass';
    document.documentElement.dataset.fixtureReady = 'command-catalog';
  });
})();
`;

const scenes = [
  { name: "command-app-desktop-light-900", native: true, theme: "light" },
  { name: "command-app-browser-dark-900", native: false, theme: "dark" },
] as const;

for (const scene of scenes) {
  it.effect(`exports P30 ${scene.name} through the actual root renderer`, () =>
    Effect.gen(function* commandCatalogExport() {
      const base = commandCatalogFixture(scene.native, "menu-bar", scene.theme);

      const model = {
        ...base,
        calendar: { ...base.calendar, viewport: 755, viewportWidth: 455 },
      };

      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const root = new DOMParser().parseFromString(rendered.html, "text/html");
      expect(
        root.querySelector("#command-desktop-menu-bar") !== null,
        "Export must preserve desktop-only applicability"
      ).toBe(scene.native);
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="fixture-viewport" content="900x900"><title>P30 ${scene.name}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="command-catalog-evidence">${JSON.stringify(scene)}</script><script data-command-catalog-proof>${proof}</script></body></html>`;
      const directory = "../../.rat/command-catalog/ui";
      yield* fs.makeDirectory(directory, { recursive: true });
      const file = `${directory}/${scene.name}.html`;
      yield* publishFixtureArtifact(file, html);
      expect(yield* fs.readFileString(file)).toBe(html);
    }).pipe(Effect.provide(NodeServices.layer))
  );
}
