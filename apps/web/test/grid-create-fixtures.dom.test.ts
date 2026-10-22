import { runInNewContext } from "node:vm";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { EditorView } from "../src/client/editing/editor-model.js";
import { view } from "../src/features/app.js";
import { nativeCreatedGridDraft } from "./grid-create-native-fixture.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

for (const alt of [false, true]) {
  for (const width of [900, 1440]) {
    for (const theme of ["light", "dark"] as const) {
      it.effect(
        `exports native ${alt ? "Alt" : "plain"} double-click draft ${theme} ${width}`,
        () =>
          Effect.gen(function* createdGridArtifact() {
            const native = yield* nativeCreatedGridDraft(alt, width, theme);
            const editor = native.model.editing.view;
            expect(EditorView.guards.Editing(editor)).toBe(true);

            if (!EditorView.guards.Editing(editor)) {
              return yield* Effect.die(
                "Completed native double-click did not open an ordinary draft"
              );
            }

            expect(editor.kind).toBe("create");
            expect(editor.draft.allDay).toBe(false);
            expect(editor.draft.startTime).toBe(alt ? "09:05" : "09:00");
            expect(editor.draft.endTime).toBe(alt ? "09:10" : "09:30");
            expect(native.gesture.id).toBe(1);

            const rendered = yield* renderToString(
              { init: () => ({ model: native.model }), view },
              { isHydratable: false }
            );

            const fs = yield* FileSystem.FileSystem;
            const css = yield* fs.readFileString("src/client/style.css");
            const proof = JSON.stringify({ alt, width });

            const script = `(() => {
            const proof = ${proof};
            const require = (value, message) => { if (!value) throw new Error(message); };
            const dialog = document.querySelector("#event-editor-dialog");
            require(dialog !== null, "actual editor dialog");
            const standIn = window.__gridCreateStandIn === true;
            if (standIn) dialog.setAttribute("open", "");
            else if (!dialog.open) dialog.showModal();
            require(dialog.open, "editor is open");
            const start = dialog.querySelector("#event-startTime");
            const end = dialog.querySelector("#event-endTime");
            require(start !== null && end !== null, "actual time controls");
            require(start.value === (proof.alt ? "9:05am" : "9am"), "created start");
            require(end.value === (proof.alt ? "9:10am" : "9:30am"), "created end");
            require(!dialog.querySelector("#event-allDay").checked, "timed draft");
            if (!standIn) {
              const bounds = dialog.getBoundingClientRect();
              require(bounds.width > 0 && bounds.height > 0, "visible native editor");
              require(start.getBoundingClientRect().width > 0 && end.getBoundingClientRect().width > 0, "visible inputs");
              require(window.innerWidth === proof.width, "requested viewport width");
              require(document.documentElement.scrollWidth <= window.innerWidth + 1, "page has no horizontal overflow");
            }
            document.documentElement.dataset.gridCreateProof = standIn ? "JSDOM stand-in; not browser proof" : "browser";
            document.documentElement.dataset.fixtureReady = "grid-create";
          })();`;

            const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${rendered.html}<script>${script}</script></body></html>`;
            const container = document.createElement("div");
            container.innerHTML = html;
            document.body.append(container);
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                container.remove();
              })
            );
            const exactScript = container.querySelector("script")?.textContent;
            expect(exactScript).toBe(script);
            runInNewContext(
              exactScript ?? "throw new Error('Missing exact script')",
              {
                document,
                window: { __gridCreateStandIn: true, innerWidth: width },
              }
            );
            expect(document.documentElement.dataset.fixtureReady).toBe(
              "grid-create"
            );
            expect(document.documentElement.dataset.gridCreateProof).toBe(
              "JSDOM stand-in; not browser proof"
            );

            return yield* publishFixtureArtifact(
              `../../.git/grid-create-${alt ? "alt" : "plain"}-${theme}-${width}-fixture.html`,
              html
            );
          }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
      );
    }
  }
}
