import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Crypto, Effect, FileSystem } from "effect";

import { selectedEvent } from "../src/client/keyboard/registry.js";
import {
  captureShortcutCommands,
  pressEditorShortcut,
  receiveShortcutEditor,
  renderShortcutRoot,
  shortcutFixture,
  shortcutScenes,
} from "./editor-shortcut-fixture.js";
import {
  prepareShortcutProofWithStandInBoxes,
  shortcutProofScript,
} from "./editor-shortcut-proof.js";

const gridWidth = (width: number) => width - (width <= 1000 ? 445 : 520);

it.effect(
  "exports root E then J recipients and refusals with the exact embedded focus and geometry proof executed against every HTML artifact",
  () =>
    Effect.gen(function* exportShortcutFixtures() {
      const fs = yield* FileSystem.FileSystem;
      const crypto = yield* Crypto.Crypto;
      const css = yield* fs.readFileString("src/client/style.css");

      const fixtureProof = yield* Effect.acquireRelease(
        Effect.sync(prepareShortcutProofWithStandInBoxes),
        (ready) =>
          Effect.sync(() => {
            ready.dispose();
          })
      );

      const scenarios = shortcutScenes.map((scene) => ({
        base: shortcutFixture(scene),
        scene,
      }));

      const fixtures: {
        path: string;
        sha256: string;
        scene: string;
        width: number;
        theme: string;
      }[] = [];

      for (const width of [1440, 900]) {
        for (const theme of ["light", "dark"] as const) {
          for (const { base, scene } of scenarios) {
            const eligible =
              scene === "with-conferencing" || scene === "without-conferencing";

            const result = pressEditorShortcut(
              {
                ...base,
                calendar: {
                  ...base.calendar,
                  viewportWidth: gridWidth(width),
                },
                settings: { ...base.settings, theme },
              },
              "j"
            );

            const commands = yield* captureShortcutCommands(result);
            expect(commands).toHaveLength(eligible ? 1 : 0);

            const model = eligible
              ? receiveShortcutEditor(result.model)
              : result.model;

            let refusalProof = "";

            if (!eligible) {
              const before = selectedEvent(base);
              const after = selectedEvent(model);
              expect(before).toBeDefined();
              expect(after).toEqual(before);
              expect(model.calendar.selected).toEqual(base.calendar.selected);
              expect(model.calendar.reads).toBe(base.calendar.reads);
              const source = before?.source;

              const calendar = base.calendar.calendars.find(
                (entry) =>
                  entry.accountId === source?.accountId &&
                  entry.calendarId === source.calendarId
              );

              expect(calendar).toBeDefined();
              expect(
                scene === "readonly" ? calendar?.accessRole : source?.eventType
              ).toBe(scene === "readonly" ? "reader" : "outOfOffice");

              const beforeRender = yield* renderShortcutRoot({
                ...base,
                calendar: {
                  ...base.calendar,
                  viewportWidth: gridWidth(width),
                },
                settings: { ...base.settings, theme },
              });

              const beforeDom = new DOMParser().parseFromString(
                beforeRender.html,
                "text/html"
              );

              const panelHtml =
                beforeDom.querySelector(".detail-panel")?.outerHTML;

              expect(panelHtml).toBeDefined();

              const evidence = {
                accessRole: calendar?.accessRole,
                eventType: source?.eventType,
                identity: {
                  accountId: source?.accountId,
                  calendarId: source?.calendarId,
                  eventId: source?.eventId,
                },
                panelHtml,
                scene,
                selected: model.calendar.selected,
                title: before?.title,
              };

              refusalProof = `const precondition = ${JSON.stringify(evidence)};\nconst panel = document.querySelector('.detail-panel');\nif (!precondition.identity.eventId || precondition.selected.length === 0 || !panel) throw Error('Missing selected refusal event');\nif (precondition.scene === 'readonly' && precondition.accessRole !== 'reader') throw Error('Not a read-only source');\nif (precondition.scene === 'unsupported' && precondition.eventType !== 'outOfOffice') throw Error('Not an out-of-office source');\nif (panel.outerHTML !== precondition.panelHtml || panel.querySelector('h2')?.textContent !== precondition.title) throw Error('Selection or panel changed');\nconst calendarKey = JSON.stringify([precondition.identity.accountId, precondition.identity.calendarId]);\nif (![...panel.querySelectorAll('[data-calendar-key]')].some(row => row.dataset.calendarKey === calendarKey)) throw Error('Wrong source calendar');\nif (precondition.scene === 'readonly' && !panel.textContent.includes('This calendar is read-only.')) throw Error('Missing read-only panel');\nif (document.querySelector('.workspace')?.textContent.includes('Loading events')) throw Error('Refusal fixture is loading');\n`;
            }

            const rendered = yield* renderShortcutRoot(model);
            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>Editor shortcut ${scene} ${theme}</title><style>${css}</style></head><body>${rendered.html}<script>${refusalProof}${shortcutProofScript(eligible)}</script></body></html>`;
            const proof = fixtureProof.execute(html, width);
            expect(proof.documentElement.dataset.editorShortcutProof).toBe(
              "pass"
            );
            const path = `.git/editor-shortcut-${scene}-${theme}-${width}-fixture.html`;
            yield* fs.writeFileString(`../../${path}`, html);
            fixtures.push({
              path,
              scene,
              sha256: Array.from(
                yield* crypto.digest("SHA-256", new TextEncoder().encode(html)),
                (byte) => byte.toString(16).padStart(2, "0")
              ).join(""),
              theme,
              width,
            });
          }
        }
      }

      expect(fixtures).toHaveLength(16);
      yield* fs.writeFileString(
        "../../.git/editor-shortcut-fixtures-v2.json",
        `${JSON.stringify({ base: "89489bb", fixtures, height: 900, proofAttribute: "data-editor-shortcut-proof", proofValue: "pass", review: "layton-editor-shortcuts-2", workerQualification: "Exact exported script executes under DOM stand-in boxes; real geometry remains desk-qualified." }, null, 2)}\n`
      );
    }).pipe(Effect.provide(NodeServices.layer))
);
