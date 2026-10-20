import { it, expect } from "@effect/vitest";
import { Effect } from "effect";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { SavePreferences } from "../src/client/commands.js";
import { DispatchEditing } from "../src/client/editing/commands.js";
import { PrepareEditingDialogs } from "../src/client/editing/dialog-mount.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { PrepareKeyboard } from "../src/client/keyboard/mount.js";
import { view } from "../src/features/app.js";
import { settingsPage } from "../src/features/settings.js";
import { CalendarRoute, SettingsRoute } from "../src/layout/route.js";
import { fixtureModel } from "./fixture.js";

it.effect(
  "General selects change the actual app appearance and persist without leaving settings",
  () =>
    Effect.sync(() => {
      const base = fixtureModel();
      Scene.scene(
        { update, view },
        Scene.given({
          ...base,
          route: SettingsRoute.make({ page: "general" }),
        }),
        Scene.Mount.resolve(PrepareKeyboard, Message.KeyboardClose()),
        Scene.Mount.resolve(
          PrepareEditingDialogs,
          Message.EditingAction({ action: EditorAction.cases.Cancel.make({}) })
        ),
        Scene.Command.resolve(DispatchEditing, Message.DispatchedEditing()),
        Scene.change(Scene.selector("#settings-theme"), "dark"),
        Scene.Command.resolve(SavePreferences, Message.SavedPreferences()),
        Scene.expect(Scene.selector(".theme-dark")).toExist(),
        Scene.expect(Scene.selector("#settings-theme")).toHaveAttr(
          "value",
          "dark"
        ),
        Scene.change(Scene.selector("#settings-clock"), "24"),
        Scene.Command.resolve(SavePreferences, Message.SavedPreferences()),
        Scene.expect(Scene.selector("#settings-clock")).toHaveAttr(
          "value",
          "24"
        ),
        Scene.change(Scene.selector("#settings-week-numbers"), "shown"),
        Scene.Command.resolve(SavePreferences, Message.SavedPreferences()),
        Scene.expect(Scene.selector("#settings-week-numbers")).toHaveAttr(
          "value",
          "shown"
        ),
        Scene.expect(Scene.selector(".workspace")).toBeAbsent()
      );
    })
);

it.effect(
  "Settings shell Escape uses the existing Calendar route request",
  () =>
    Effect.sync(() => {
      const messages: AppMessage[] = [];
      Scene.scene(
        {
          update: (model: AppModel, message: AppMessage) => {
            messages.push(message);

            return { model };
          },
          view: (model: AppModel, h: HtmlBuilder<AppMessage>) => ({
            body: settingsPage(model, h, "general"),
            title: "Settings",
          }),
        },
        Scene.given(fixtureModel()),
        Scene.keydown(Scene.selector(".settings-shell"), "Escape")
      );
      expect(messages).toEqual([
        Message.RequestedRoute({
          replace: true,
          route: CalendarRoute.make({}),
        }),
      ]);
    })
);
