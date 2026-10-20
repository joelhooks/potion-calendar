import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import { ApplyDesktopRequest } from "../src/client/desktop/commands.js";
import {
  DesktopNotice,
  DesktopOutcome,
  RemoteDesktop,
  initialDesktop,
} from "../src/client/desktop/model.js";
import { DispatchEditing } from "../src/client/editing/commands.js";
import { PrepareEditingDialogs } from "../src/client/editing/dialog-mount.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { PrepareKeyboard } from "../src/client/keyboard/mount.js";
import { view } from "../src/features/app.js";
import { SettingsRoute } from "../src/layout/route.js";
import { fixtureModel } from "./fixture.js";

const settings = {
  issues: [],
  openAtLogin: false,
  preferences: defaultDesktopPreferences(),
  revision: 1,
};

const mounted = [
  Scene.Mount.resolve(PrepareKeyboard, Message.KeyboardClose()),
  Scene.Mount.resolve(
    PrepareEditingDialogs,
    Message.EditingAction({ action: EditorAction.cases.Cancel.make({}) })
  ),
  Scene.Command.resolve(DispatchEditing, Message.DispatchedEditing()),
];

it.effect(
  "the hosted General slot keeps native startup on OS truth after a refused toggle",
  () =>
    Effect.sync(() => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...fixtureModel(),
          desktop: {
            ...initialDesktop(),
            availability: "available",
            settings: RemoteDesktop.Success({ data: settings }),
          },
          route: SettingsRoute.make({ page: "general" }),
        }),
        ...mounted,
        Scene.expect(Scene.selector('a[href="/settings/menu-bar"]')).toExist(),
        Scene.change(Scene.selector("#desktop-open-calendar"), "on"),
        Scene.expect(Scene.selector("#desktop-open-calendar")).toHaveValue(
          "off"
        ),
        Scene.expect(Scene.selector("#desktop-open-calendar")).toBeDisabled(),
        Scene.Command.resolve(
          ApplyDesktopRequest,
          Message.ReceivedDesktop({
            notice: DesktopNotice.cases.Finished.make({
              outcome: DesktopOutcome.cases.Ready.make({
                error: Option.some(
                  "macOS has not applied the login-item change."
                ),
                settings: { ...settings, revision: 2 },
              }),
              request: 1,
            }),
          })
        ),
        Scene.expect(Scene.selector("#desktop-open-calendar")).toHaveValue(
          "off"
        ),
        Scene.expect(Scene.selector("#desktop-open-calendar")).toBeEnabled(),
        Scene.expect(
          Scene.text("macOS has not applied the login-item change.")
        ).toExist(),
        Scene.expect(Scene.selector("#settings-upcoming-meeting")).toExist()
      );
    })
);

it.effect(
  "the hosted Menu bar route renders its controls but normal browsers have no desktop nav",
  () =>
    Effect.sync(() => {
      expect(window.potionDesktop).toBeUndefined();
      Scene.scene(
        { update, view },
        Scene.given({
          ...fixtureModel(),
          desktop: {
            ...initialDesktop(),
            availability: "available",
            settings: RemoteDesktop.Success({ data: settings }),
          },
          route: SettingsRoute.make({ page: "menu-bar" }),
        }),
        ...mounted,
        Scene.expect(Scene.selector("#desktop-include-days")).toHaveValue("3"),
        Scene.expect(Scene.selector("#desktop-preview-minutes")).toHaveValue(
          "720"
        )
      );
      Scene.scene(
        { update, view },
        Scene.given({
          ...fixtureModel(),
          desktop: { ...initialDesktop(), availability: "unavailable" },
          route: SettingsRoute.make({ page: "general" }),
        }),
        ...mounted,
        Scene.expect(
          Scene.selector('a[href="/settings/menu-bar"]')
        ).toBeAbsent(),
        Scene.expect(Scene.selector("#desktop-open-calendar")).toBeAbsent()
      );
      Scene.scene(
        { update, view },
        Scene.given({
          ...fixtureModel(),
          desktop: { ...initialDesktop(), availability: "unavailable" },
          route: SettingsRoute.make({ page: "notifications" }),
        }),
        ...mounted,
        Scene.expect(Scene.selector("#desktop-prompt-minutes")).toBeAbsent(),
        Scene.expect(
          Scene.selector('a[href="/settings/menu-bar"]')
        ).toBeAbsent()
      );
      Scene.scene(
        { update, view },
        Scene.given({
          ...fixtureModel(),
          desktop: { ...initialDesktop(), availability: "unavailable" },
          route: SettingsRoute.make({ page: "menu-bar" }),
        }),
        ...mounted,
        Scene.expect(Scene.selector("#desktop-menu-bar")).toBeAbsent(),
        Scene.expect(Scene.selector("#desktop-include-days")).toBeAbsent()
      );
    })
);
