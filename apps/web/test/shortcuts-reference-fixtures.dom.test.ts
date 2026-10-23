import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";
import { vi } from "vitest";

import { view } from "../src/features/app.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";
import {
  readOnlyCommandsFixture,
  shortcutsReferenceFixture,
} from "./shortcuts-reference-fixture.js";

const proof = String.raw`
(() => {
  const requireFact = (ok, text) => { if (!ok) throw Error(text); };
  const evidence = JSON.parse(document.querySelector('#shortcuts-reference-evidence').textContent);
  const dialog = document.querySelector('#keyboard-command-dialog');
  if (dialog) dialog.showModal();
  requestAnimationFrame(() => {
    requireFact(innerWidth === evidence.width && innerHeight === 900, 'Unexpected shortcuts fixture viewport');
    requireFact(document.documentElement.scrollWidth <= innerWidth, 'Shortcuts fixture widened viewport');
    if (evidence.scene === 'read-only') {
      requireFact(dialog && dialog.open && dialog.matches(':modal'), 'Read-only command menu is not native modal');
      requireFact(!document.querySelector('#command-create'), 'Read-only command menu exposes Create');
      const create = document.querySelector('.toolbar button[title="Create event (C)"]');
      requireFact(create && create.disabled, 'Read-only toolbar Create is not disabled');
      requireFact(create.textContent.trim() === 'Create' && create.getAttribute('aria-hidden') !== 'true', 'Disabled Create lost its accessible name');
      requireFact(getComputedStyle(create).display !== 'none', 'Disabled Create was hidden instead');
    } else {
      const page = document.querySelector('#shortcuts-page');
      const sections = [...page.querySelectorAll(':scope > section')];
      requireFact(sections[0].id === 'system-wide' && sections[1].id === 'general', 'System-wide is not before General');
      const rows = [...sections[0].querySelectorAll('[data-shortcut-id]')];
      requireFact(rows.length === evidence.keys.length, 'Configured global shortcut count changed');
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        requireFact(row.querySelector('kbd').textContent === evidence.keys[index], 'Configured global key differs from desktop bridge');
        const box = row.getBoundingClientRect();
        requireFact(box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, 'System-wide row is clipped');
      }
    }
    document.documentElement.dataset.shortcutsReferenceProof = 'pass';
    document.documentElement.dataset.fixtureReady = 'shortcuts-reference';
  });
})();
`;

const scenes = [
  {
    keys: ["⌃⌘K", "⌃⌘J"],
    name: "system-wide-light-1440",
    scene: "both",
    theme: "light",
    width: 1440,
  },
  {
    keys: ["⌃⌘K"],
    name: "system-wide-dark-900",
    scene: "one",
    theme: "dark",
    width: 900,
  },
  {
    keys: [],
    name: "read-only-commands-light-900",
    scene: "read-only",
    theme: "light",
    width: 900,
  },
] as const;

for (const scene of scenes) {
  it.effect(`exports P24 ${scene.name} through the actual root renderer`, () =>
    Effect.gen(function* shortcutsReferenceExport() {
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel")
        ),
        (spy) =>
          Effect.sync(() => {
            spy.mockRestore();
          })
      );

      const base =
        scene.scene === "read-only"
          ? readOnlyCommandsFixture()
          : shortcutsReferenceFixture(
              {
                joinShortcut:
                  scene.scene === "both" ? "Control+Command+J" : null,
                menuShortcut: "Control+Command+K",
              },
              scene.theme
            );

      const model = {
        ...base,
        calendar: {
          ...base.calendar,
          viewport: 755,
          viewportWidth: scene.width - (scene.width <= 1000 ? 445 : 520),
        },
      };

      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const root = new DOMParser().parseFromString(rendered.html, "text/html");

      if (scene.scene === "read-only") {
        expect(
          root.querySelector("#command-create"),
          "Read-only fixture must hide Create"
        ).toBeNull();
        expect(
          root.querySelector<HTMLButtonElement>(
            '.toolbar button[title="Create event (C)"]'
          )?.disabled,
          "Read-only fixture toolbar must disable Create"
        ).toBe(true);
      } else {
        expect(
          [...root.querySelectorAll("#system-wide kbd")].map(
            (key) => key.textContent
          ),
          "Desktop fixture must show configured System-wide shortcuts"
        ).toEqual(scene.keys);
      }

      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="fixture-viewport" content="${scene.width}x900"><meta name="fixture-keyboard-platform" content="MacIntel"><title>P24 ${scene.name}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="shortcuts-reference-evidence">${JSON.stringify(scene)}</script><script data-shortcuts-reference-proof>${proof}</script></body></html>`;
      const directory = "../../.rat/shortcuts-reference/ui";
      yield* fs.makeDirectory(directory, { recursive: true });
      const file = `${directory}/${scene.name}.html`;
      yield* publishFixtureArtifact(file, html);
      expect(yield* fs.readFileString(file)).toBe(html);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
}
