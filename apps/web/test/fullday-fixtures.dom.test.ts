import { runInNewContext } from "node:vm";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { EditorView } from "../src/client/editing/editor-model.js";
import { view } from "../src/features/app.js";
import { isoFromDay } from "../src/layout/navigation.js";
import {
  fulldayModel,
  fulldayScenes,
  mountedFullday,
} from "./fullday-fixture.js";
import { fulldaySession } from "./fullday-runtime-fixture.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

for (const scene of fulldayScenes) {
  for (const width of [900, 1440, 390]) {
    for (const theme of ["light", "dark"] as const) {
      it.effect(`exports full-day ${scene} ${theme} ${width}`, () =>
        Effect.gen(function* fullDayArtifact() {
          const h = yield* mountedFullday(
            fulldayModel(scene, width, theme),
            "MacIntel"
          );

          const cell = yield* Effect.fromNullishOr(
            scene === "all-day"
              ? [
                  ...h.root.querySelectorAll<HTMLElement>(
                    ".all-day-cell[data-day]"
                  ),
                ].at(-1)
              : h.cells.at(-1)
          );

          const date = isoFromDay(Number(cell.dataset.day));

          const modifiers = {
            alt: scene === "alt",
            mod: scene !== "plain" && scene !== "alt",
          };

          yield* h.click(cell, 100, 547, modifiers);
          expect(h.commands).toHaveLength(0);
          yield* h.click(cell, 300, 547, modifiers);
          let model = h.get();
          const fullDay = scene !== "plain" && scene !== "alt";

          if (scene === "refused") {
            expect(h.commands).toHaveLength(0);
            expect(Option.getOrNull(model.error)).toBe(
              "No writable calendar is available."
            );
          } else {
            expect(h.commands).toHaveLength(1);
            const command = yield* Effect.fromNullishOr(h.commands[0]);
            model = (yield* fulldaySession(model, command, date)).opened;
            const editor = model.editing.view;
            expect(EditorView.guards.Editing(editor)).toBe(true);

            if (!EditorView.guards.Editing(editor)) {
              return yield* Effect.die("No actual prepared editor");
            }

            expect(editor.draft.allDay).toBe(fullDay);
            expect(editor.draft.startDate).toBe(date);
            expect(editor.draft.endDate).toBe(date);

            if (fullDay) {
              expect(editor.draft.reminders).toEqual({
                overrides: [],
                useDefault: false,
              });
            } else {
              expect(editor.draft.startTime).toBe(
                scene === "alt" ? "09:05" : "09:00"
              );
              expect(editor.draft.endTime).toBe(
                scene === "alt" ? "09:10" : "09:30"
              );
            }
          }

          const rendered = yield* renderToString(
            { init: () => ({ model }), view },
            { isHydratable: false }
          );

          const fs = yield* FileSystem.FileSystem;
          const css = yield* fs.readFileString("src/client/style.css");
          const proof = JSON.stringify({ date, fullDay, scene, width });

          const script = `(() => {
          const proof = ${proof};
          const require = (value, message) => { if (!value) throw new Error(message); };
          const standIn = window.__fulldayStandIn === true;
          const dialog = document.querySelector("#event-editor-dialog");
          if (proof.scene === "refused") {
            require(dialog === null, "no editor on refusal");
            require(document.body.textContent.includes("No writable calendar is available."), "actual refusal");
          } else {
            require(dialog !== null, "actual prepared editor");
            if (standIn) dialog.setAttribute("open", ""); else if (!dialog.open) dialog.showModal();
            require(dialog.open, "open editor");
            require(dialog.querySelector("#event-allDay").checked === proof.fullDay, "date-only state");
            require(dialog.querySelector("#event-startDate").value === proof.date, "actual start date");
            require(dialog.querySelector("#event-endDate").value === proof.date, "actual inclusive last date");
            require(!dialog.querySelector("#event-startDate").disabled, "writable date control");
            if (proof.fullDay) require(dialog.querySelector("#event-startTime") === null, "not a timed midnight block");
            if (!standIn) require(dialog.getBoundingClientRect().width > 0, "visible native editor");
          }
          if (!standIn) {
            require(window.innerWidth === proof.width, "requested viewport");
            require(document.documentElement.scrollWidth <= window.innerWidth + 1, "no page overflow");
          }
          document.documentElement.dataset.fulldayProof = standIn ? "JSDOM stand-in; not browser proof" : "browser";
          document.documentElement.dataset.fixtureReady = "fullday";
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
          runInNewContext(exactScript ?? "throw new Error('Missing proof')", {
            document,
            window: { __fulldayStandIn: true, innerWidth: width },
          });
          expect(document.documentElement.dataset.fulldayProof).toBe(
            "JSDOM stand-in; not browser proof"
          );
          expect(document.documentElement.dataset.fixtureReady).toBe("fullday");

          return yield* publishFixtureArtifact(
            `../../.git/fullday-${scene}-${theme}-${width}-fixture.html`,
            html
          );
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
      );
    }
  }
}
