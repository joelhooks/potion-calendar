import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Predicate } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { EditingCommand } from "../src/client/editing/runtime.js";
import { commandChoices } from "../src/client/keyboard/choices.js";
import { SettingsChange } from "../src/client/settings/model.js";
import { view } from "../src/features/app.js";
import { commandChoiceFixture } from "./command-choice-fixture.js";
import {
  commandChoiceProofScript,
  executeCommandChoiceProofWithStandIns,
} from "./command-choice-proof.js";
import { stagedCommandColorFixture } from "./command-color-editor-fixture.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

const screens = {
  "color-staged": "closed",
  colors: "colors",
  "colors-multiple": "commands",
  "colors-no-palette": "colors",
  "colors-read-only": "commands",
  theme: "theme",
  "week-filtered": "week-start",
  "week-start": "week-start",
} as const;

type Scene = keyof typeof screens;

const scenes: readonly Scene[] = [
  "theme",
  "week-start",
  "week-filtered",
  "colors",
  "colors-no-palette",
  "colors-multiple",
  "colors-read-only",
  "color-staged",
];

const sceneModel = (
  scene: Scene,
  theme: "light" | "dark",
  width: number,
  staged: AppModel
): AppModel => {
  let base =
    scene === "color-staged"
      ? staged
      : commandChoiceFixture(scene === "colors-no-palette" ? [] : ["7", "11"]);

  if (scene === "colors-multiple") {
    base = {
      ...base,
      calendar: {
        ...base.calendar,
        selected: [...base.calendar.selected, "second-selected-key"],
      },
    };
  }

  if (scene === "colors-read-only") {
    base = {
      ...base,
      calendar: {
        ...base.calendar,
        calendars: base.calendar.calendars.map((calendar) => ({
          ...calendar,
          accessRole: "reader",
        })),
      },
    };
  }

  const shown: AppModel = {
    ...base,
    calendar: { ...base.calendar, viewport: 844, viewportWidth: width - 220 },
    settings: { ...base.settings, theme },
  };

  if (scene === "color-staged") {
    return shown;
  }

  let { model } = update(shown, Message.KeyboardAction({ id: screens[scene] }));

  if (
    scene === "colors-multiple" ||
    scene === "colors-read-only" ||
    scene === "week-filtered"
  ) {
    ({ model } = update(
      model,
      Message.KeyboardQuery({
        query: scene === "week-filtered" ? "Monday" : "color",
      })
    ));
  }

  return model;
};

it.effect(
  "exports modal command-choice submenus and an actual unsaved editor color at both widths and themes",
  () =>
    Effect.gen(function* commandChoiceArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      const staged = yield* stagedCommandColorFixture();
      expect(EditorView.guards.Editing(staged.model.editing.view)).toBe(true);

      const stagedColor = EditorView.guards.Editing(staged.model.editing.view)
        ? staged.model.editing.view.draft.colorId
        : null;

      for (const width of [1440, 900]) {
        for (const theme of ["light", "dark"] as const) {
          for (const scene of scenes) {
            const model = sceneModel(scene, theme, width, staged.model);
            const choices = commandChoices(model);

            const action = staged.rootCommands.find(
              EditingCommand.guards.Action
            );

            const evidence = {
              action: action?.action._tag ?? null,
              commands: staged.rootCommands.map((command) => command._tag),
              draftColor: stagedColor,
              exact: choices.find((choice) => choice.exact)?.id ?? null,
              initialColor: staged.initialColor,
              query: model.keyboard.query,
              readOnly: scene === "colors-read-only",
              scene,
              selected: model.calendar.selected.length,
              sourceColor: staged.source.colorId ?? null,
              themeTargets: choices.flatMap((choice) =>
                Predicate.isTagged(choice.message, "ChangedSettings") &&
                SettingsChange.guards.Theme(choice.message.change)
                  ? [choice.message.change.value]
                  : []
              ),
              weekStart: model.calendar.navigation.weekStartsOn ?? 0,
              writes: staged.writes.length,
            };

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const renderedDocument = new DOMParser().parseFromString(
              rendered.html,
              "text/html"
            );

            expect(
              renderedDocument.querySelector(
                scene === "color-staged"
                  ? "#event-editor-dialog"
                  : "#keyboard-command-dialog"
              )
            ).not.toBeNull();
            const payload = JSON.stringify(evidence).replaceAll("<", "\\u003c");
            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>Command choices ${scene} ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="command-choice-evidence">${payload}</script><script data-command-choice-proof>${commandChoiceProofScript}</script></body></html>`;
            const path = `../../.git/command-choice-${scene}-${theme}-${width}-fixture.html`;
            yield* publishFixtureArtifact(path, html);
            const disk = yield* fs.readFileString(path);
            expect(disk).toBe(html);
            const proof = executeCommandChoiceProofWithStandIns(disk, width);
            expect(proof.documentElement.dataset.commandChoiceProof).toBe(
              "pass"
            );
            yield* publishFixtureArtifact(
              path.replace(".html", ".json"),
              JSON.stringify({
                proof: proof.documentElement.dataset.commandChoiceProof,
                qualification:
                  "Exact disk-read script with labelled modal-state/geometry stand-ins. Requires separate desk fenced Chromium capture/read.",
                scene,
                theme,
                width,
              })
            );
          }
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
