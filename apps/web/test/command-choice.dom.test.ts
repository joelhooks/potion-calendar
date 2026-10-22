import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema, Stream } from "effect";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { SavePreferences } from "../src/client/commands.js";
import { DispatchEditing } from "../src/client/editing/commands.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { EditorInputFailure } from "../src/client/editing/input-failure.js";
import {
  EditingCommand,
  EditingNotice,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { formatKey } from "../src/client/keyboard/hints.js";
import { view as appView } from "../src/features/app.js";
import { commandMenu } from "../src/features/command-menu.js";
import {
  commandChoiceFixture,
  readyCommandColor,
} from "./command-choice-fixture.js";
import {
  commandChoiceProofScript,
  executeCommandChoiceProofWithStandIns,
} from "./command-choice-proof.js";
import { stagedCommandColorFixture } from "./command-color-editor-fixture.js";

it.effect.prop(
  "command-choice modal proof refuses closed and nonmodal fixtures before geometry",
  { presentation: Schema.Literals(["closed", "nonmodal"]) },
  ({ presentation }) =>
    Effect.sync(() => {
      const html = `<dialog id="keyboard-command-dialog"></dialog><script id="command-choice-evidence" type="application/json">{}</script><script data-command-choice-proof>${commandChoiceProofScript}</script>`;
      expect(() =>
        executeCommandChoiceProofWithStandIns(html, 900, presentation)
      ).toThrow("Command-choice dialog is not modal");
    })
);

const view = (model: AppModel, h: HtmlBuilder<AppMessage>) =>
  h.div([], commandMenu(model, h));

it.effect.each(["color", "toggleAllDay"])(
  "failed %s editor dispatch cancels its opening intent and cannot replay on a later ready notice",
  (kind) =>
    Effect.gen(function* failedOpeningDispatch() {
      const base = commandChoiceFixture();

      const picked =
        kind === "color"
          ? update(
              update(base, Message.KeyboardAction({ id: "colors" })).model,
              Message.KeyboardPick({ id: "color-7" })
            )
          : update(base, Message.KeyboardAction({ id: "edit:allDay" }));

      const command = picked.commands?.find(
        (entry) => entry.name === "DispatchEditing"
      );

      if (command === undefined) {
        return yield* Effect.die("Opening fixture did not dispatch the editor");
      }

      const args = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ command: EditingCommand, personId: Schema.String })
      )(command.args);

      const message = yield* DispatchEditing(args).effect.pipe(
        Effect.provideService(
          EditingRuntime,
          EditingRuntime.of({
            connect: () => Effect.succeed(Stream.empty),
            dispatch: () =>
              Effect.fail(
                new EditorInputFailure({
                  message: "Fixture editor dispatch failed",
                })
              ),
          })
        )
      );

      const failed = update(picked.model, message);
      expect(failed.model.error).toEqual(
        Option.some("Fixture editor dispatch failed")
      );
      expect(failed.model.keyboard.opening).toBe("none");
      const ready = readyCommandColor(failed.model);

      const late = update(
        failed.model,
        Message.ReceivedEditing({
          notice: EditingNotice.cases.Editor.make({
            error: Option.none(),
            mutation: Option.none(),
            plan: Option.none(),
            saving: false,
            view: ready.editing.view,
          }),
          personId: Option.getOrThrow(base.person),
        })
      );

      expect(late.model.keyboard.opening).toBe("none");
      expect(late.commands ?? []).toEqual([]);

      return late.model;
    })
);

it.effect(
  "cycle-theme keeps its Shift-Mod-L binding discoverable in the actual Shortcuts reference",
  () =>
    Effect.gen(function* themeShortcutReference() {
      const { model } = update(
        commandChoiceFixture(),
        Message.KeyboardAction({ id: "shortcuts" })
      );

      const rendered = yield* renderToString(
        { init: () => ({ model }), view: appView },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const row = document.querySelector('[data-shortcut-id="cycle-theme"]');
      expect(row).not.toBeNull();
      expect(row?.textContent).toContain("Cycle theme");
      expect(row?.querySelector("kbd")?.textContent).toBe(
        formatKey("Shift+Mod+l", navigator.platform)
      );
    })
);

it.effect(
  "native submenu clicks reach the existing preference and editor command recipients",
  () =>
    Effect.sync(() => {
      const base = commandChoiceFixture();
      Scene.scene(
        { update, view },
        Scene.given(
          update(base, Message.KeyboardAction({ id: "theme" })).model
        ),
        Scene.click(Scene.role("option", { name: "Dark mode" })),
        Scene.Command.expectHas(SavePreferences),
        Scene.Command.resolve(SavePreferences, Message.SavedPreferences())
      );
      Scene.scene(
        { update, view },
        Scene.given(
          update(base, Message.KeyboardAction({ id: "colors" })).model
        ),
        Scene.click(Scene.role("option", { name: "Blue" })),
        Scene.Command.expectHas(DispatchEditing),
        Scene.Command.resolve(DispatchEditing, Message.DispatchedEditing())
      );
    })
);

it.effect(
  "the real editor actor receives the deferred color once and leaves an unsaved draft without provider writes",
  () =>
    Effect.gen(function* stagedColor() {
      const result = yield* stagedCommandColorFixture();
      expect(result.initialColor).toBe(null);
      expect(EditorView.guards.Editing(result.model.editing.view)).toBe(true);

      if (EditorView.guards.Editing(result.model.editing.view)) {
        expect(result.model.editing.view.draft.colorId).toBe("7");
        expect(result.model.editing.view.original).toMatchObject({
          value: { eventId: "a-review" },
        });
      } else {
        return yield* Effect.die("Color fixture did not stay editing");
      }

      expect(result.source.colorId).toBeUndefined();
      expect(result.rootCommands.map((command) => command._tag)).toEqual([
        "Open",
        "Action",
      ]);
      expect(result.model.keyboard.opening).toBe("none");
      expect(result.model.keyboard.screen).toBe("closed");
      expect(result.writes).toEqual([]);

      return result.model;
    }).pipe(Effect.provide(NodeServices.layer))
);
