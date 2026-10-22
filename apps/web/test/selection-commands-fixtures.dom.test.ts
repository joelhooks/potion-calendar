import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option, pipe } from "effect";
import { AsyncData } from "foldkit";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { view } from "../src/features/app.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";
import {
  commandOccurrenceReady,
  selectionCommandFixture,
} from "./selection-command-fixture.js";
import {
  executeSelectionCommandsProofWithStandIns,
  selectionCommandsProofScript,
} from "./selection-commands-proof.js";

it.effect(
  "exports recurring and ordinary catalogs plus the absent-occurrence status at both widths and themes",
  () =>
    Effect.gen(function* selectionCommandExports() {
      const fs = yield* FileSystem.FileSystem;

      const css = yield* fs.readFileString("src/client/style.css");

      const directory = "../../.rat/selection-commands/ui";
      yield* fs.makeDirectory(directory, { recursive: true });

      const themes = [
        "light",
        "dark",
      ] satisfies readonly AppModel["settings"]["theme"][];

      for (const width of [900, 1440]) {
        for (const theme of themes) {
          for (const scene of ["recurring", "single", "no-later"]) {
            const fixture = selectionCommandFixture(scene !== "single");

            const base = {
              ...fixture.model,
              calendar: {
                ...fixture.model.calendar,
                viewport: 844,
                viewportWidth: width - 220,
              },
              session: pipe(
                fixture.model.session,
                AsyncData.map((snapshot) =>
                  snapshot === null
                    ? null
                    : {
                        ...snapshot,
                        accounts: snapshot.accounts.filter(
                          (account) => !account.disconnected
                        ),
                      }
                )
              ),
              settings: { ...fixture.model.settings, theme },
            };

            const model =
              scene === "no-later"
                ? commandOccurrenceReady(base, null).model
                : update(base, Message.KeyboardAction({ id: "commands" }))
                    .model;

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const evidence = {
              pending: Option.isSome(model.selectionCommands.task),
              scene,
              selectedAfter: JSON.stringify(model.calendar.selected),
              selectedBefore: JSON.stringify(base.calendar.selected),
            };

            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>Selected commands ${scene} ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="selection-commands-evidence">${JSON.stringify(evidence).replaceAll("<", "\\u003c")}</script><script data-selection-commands-proof>${selectionCommandsProofScript}</script></body></html>`;
            const path = `${directory}/selection-commands-${scene}-${theme}-${width}.html`;
            yield* publishFixtureArtifact(path, html);
            const read = yield* fs.readFileString(path);
            expect(read).toBe(html);
            expect(
              executeSelectionCommandsProofWithStandIns(read, width)
                .documentElement.dataset.selectionCommandsProof
            ).toBe("pass");

            if (scene === "recurring") {
              expect(() =>
                executeSelectionCommandsProofWithStandIns(read, width, false)
              ).toThrow("Command dialog is not modal");
            }
          }
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
