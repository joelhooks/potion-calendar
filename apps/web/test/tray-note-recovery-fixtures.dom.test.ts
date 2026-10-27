import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";
import { trayNoteAppearanceProof } from "./tray-note-appearance-proof.js";
import { recoveryScenario } from "./tray-note-recovery-fixture.js";

const responses = [
  { name: "yes", response: "accepted" },
  { name: "no", response: "declined" },
  { name: "maybe", response: "tentative" },
] as const;

const themes = ["light", "dark"] as const;

const attribute = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

it.effect(
  "exports six retired exact-copy draft fixtures with desktop and 390px phone panes",
  () =>
    Effect.gen(function* exportRecovery() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      const pointer = yield* fs.readFileString("src/client/coarse-pointer.css");

      for (const { name, response } of responses) {
        for (const theme of themes) {
          const frames: string[] = [];

          for (const width of [1280, 390]) {
            const h = yield* recoveryScenario(width, response);
            const base = h.model();
            const model = { ...base, settings: { ...base.settings, theme } };

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const dom = new DOMParser().parseFromString(
              rendered.html,
              "text/html"
            );

            const field = dom.querySelector<HTMLTextAreaElement>(
              width === 390 ? "#phone-shell-dialog #rsvp-note" : "#rsvp-note"
            );

            expect(field?.value).toBe("Ready to discuss the timing.");
            expect(dom.querySelector("[data-tray-rsvp-note]")).toBeNull();
            expect(rendered.html).not.toContain("Add a note for");
            expect(h.calls).toHaveLength(0);
            const content = `<!doctype html><html lang="en" data-theme="${theme}" data-fixture-pane="${width === 390 ? "phone" : "desktop"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>${pointer}</style></head><body>${rendered.html}<script>const dialog=document.querySelector('#phone-shell-dialog');if(dialog&&!dialog.open){dialog.showModal();}document.documentElement.dataset.fixtureReady='tray-note-recovery';${trayNoteAppearanceProof(null)}</script></body></html>`;
            frames.push(
              `<section><h2>${width}px retired draft</h2><iframe title="${name} ${theme} ${width}" width="${width}" height="900" srcdoc="${attribute(content)}"></iframe></section>`
            );
          }

          const html = `<!doctype html><html lang="en" data-fixture-kind="tray-note-recovery"><head><meta charset="utf-8"><title>P58 ${name} ${theme}</title></head><body><h1>Retired ${name} preparation · ${theme}</h1><p>Actual root and actor history crossed meeting end. Text survives, native cue is removed and no RSVP is sent. Static fixture layout is browser-owned; this export does not prove focus continuity.</p>${frames.join("")}</body></html>`;
          yield* publishFixtureArtifact(
            `../../.git/tray-note-recovery-${name}-${theme}.html`,
            html
          );
        }
      }
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped)
);
