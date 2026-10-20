import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

import type { AppModel } from "../src/client/app.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { displayZone } from "../src/layout/time-zones.js";
import { editorViewFields } from "./editor-fixture.js";
import {
  eventZoneUiFixture,
  renderEventZoneUi,
} from "./event-zone-ui-fixture.js";

it.effect(
  "exports the actual editor, shared open picker and date-line case in both themes and viewport sizes",
  () =>
    Effect.gen(function* eventZoneArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const width of [1440, 900]) {
        for (const theme of ["light", "dark"] as const) {
          for (const scene of ["editor", "picker", "dateline"] as const) {
            const base = eventZoneUiFixture();

            const draft =
              scene === "dateline"
                ? {
                    ...editorViewFields.draft,
                    endDate: "2026-01-03",
                    endTime: "02:00",
                    startDate: "2026-01-03",
                    startTime: "01:00",
                    timeZone: "Pacific/Kiritimati",
                  }
                : { ...editorViewFields.draft, timeZone: "Asia/Tokyo" };

            const model: AppModel = {
              ...base,
              calendar: {
                ...base.calendar,
                viewportWidth: width - (width <= 1000 ? 185 + 260 : 220 + 300),
              },
              editing: {
                ...base.editing,
                view: EditorView.cases.Editing.make({
                  ...editorViewFields,
                  draft,
                }),
              },
              keyboard: {
                ...base.keyboard,
                query: scene === "picker" ? "Tokyo" : "",
                screen: scene === "picker" ? "event-zone" : "closed",
              },
              settings: { ...base.settings, theme },
              timeZones:
                scene === "dateline"
                  ? {
                      ...base.timeZones,
                      preferences: {
                        ...base.timeZones.preferences,
                        primary: displayZone("Etc/GMT+12"),
                      },
                    }
                  : base.timeZones,
            };

            const rendered = yield* renderEventZoneUi(model);

            const document = new DOMParser().parseFromString(
              rendered.html,
              "text/html"
            );

            expect(document.querySelector("#event-timeZone")?.textContent).toBe(
              scene === "dateline"
                ? "Kiritimati · GMT+14:00"
                : "Tokyo · GMT+09:00"
            );

            if (scene === "dateline") {
              expect(
                document.querySelector("#event-zone-explanation")?.textContent
              ).toContain(
                "11pm on Thursday, January 1 in your primary zone (Etc/GMT+12)"
              );
            }

            if (scene === "picker") {
              expect(
                document.querySelector(
                  "#keyboard-command-dialog [data-command-trigger-hint]"
                )
              ).toBeNull();
              expect(
                document
                  .querySelector("#keyboard-command-dialog")
                  ?.getAttribute("aria-label")
              ).toBe("Event time zone");
              expect(
                document.querySelector("[id='command-Asia/Tokyo']")
              ).not.toBeNull();
            }

            const script =
              "document.querySelectorAll('dialog[data-editing-dialog]').forEach(dialog=>{dialog.showModal();document.getElementById(dialog.dataset.initialFocus??'')?.focus()});const chooser=document.querySelector('#keyboard-command-dialog');if(chooser){chooser.showModal();chooser.querySelector('input')?.focus()}document.documentElement.dataset.fixtureReady='event-zone';";

            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>Event time zone: ${scene} ${theme}</title><style>${css}</style></head><body>${rendered.html}<script>${script}</script></body></html>`;
            yield* fs.writeFileString(
              `../../.git/event-zone-${scene}-${theme}-${width}-fixture.html`,
              html
            );
          }
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
