import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import { ApplyDesktopRequest } from "../src/client/desktop/commands.js";
import { DesktopNotice, DesktopOutcome } from "../src/client/desktop/model.js";
import { DispatchEditing } from "../src/client/editing/commands.js";
import { PrepareEditingDialogs } from "../src/client/editing/dialog-mount.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { PrepareKeyboard } from "../src/client/keyboard/mount.js";
import { view } from "../src/features/app.js";
import { SettingsRoute } from "../src/layout/route.js";
import {
  commandCatalogFixture,
  commandCatalogSettings,
} from "./command-catalog-fixture.js";

it.effect(
  "clicking the desktop command applies the same native menu-bar setting shown by Settings",
  () =>
    Effect.sync(() => {
      const base = commandCatalogFixture();
      Scene.scene(
        { update, view },
        Scene.given({
          ...base,
          route: SettingsRoute.make({ page: "menu-bar" }),
        }),
        Scene.Mount.resolve(PrepareKeyboard, Message.KeyboardClose()),
        Scene.Mount.resolve(
          PrepareEditingDialogs,
          Message.EditingAction({ action: EditorAction.cases.Cancel.make({}) })
        ),
        Scene.Command.resolve(DispatchEditing, Message.DispatchedEditing()),
        Scene.click(Scene.selector("#command-menu-button")),
        Scene.type(Scene.selector("#keyboard-query"), "menu-bar"),
        Scene.expect(Scene.selector("#command-desktop-menu-bar")).toExist(),
        Scene.expect(Scene.selector("#desktop-menu-bar")).toHaveValue("off"),
        Scene.click(Scene.selector("#command-desktop-menu-bar")),
        Scene.Command.resolve(
          ApplyDesktopRequest,
          Message.ReceivedDesktop({
            notice: DesktopNotice.cases.Finished.make({
              outcome: DesktopOutcome.cases.Ready.make({
                error: Option.none(),
                settings: { ...commandCatalogSettings(true), revision: 2 },
              }),
              request: 1,
            }),
          })
        ),
        Scene.expect(Scene.selector("#desktop-menu-bar")).toHaveValue("on"),
        Scene.expect(Scene.selector("#command-desktop-menu-bar")).toBeAbsent()
      );
    })
);

it.effect.each([true, false])(
  "actual filtered command modal projects desktop applicability without adding native controls (desktop=%s)",
  (native) =>
    Effect.gen(function* catalogRootRendering() {
      const model = commandCatalogFixture(
        native,
        "menu-bar",
        native ? "light" : "dark"
      );

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const root = new DOMParser().parseFromString(rendered.html, "text/html");
      expect(root.querySelector("#keyboard-command-dialog")).not.toBeNull();
      expect(
        root.querySelector("#command-desktop-menu-bar") !== null,
        "The actual command modal must hide desktop-only actions in a browser"
      ).toBe(native);
      expect(
        root.querySelector<HTMLInputElement>("#keyboard-query")?.value
      ).toBe("menu-bar");
      expect(root.querySelector("#desktop-menu-bar")).toBeNull();
    })
);
