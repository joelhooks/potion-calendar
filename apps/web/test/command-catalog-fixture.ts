import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { DesktopNotice, DesktopOutcome } from "../src/client/desktop/model.js";
import { keyboardFixture } from "./keyboard-fixture.js";

export const commandCatalogSettings = (menuBar = false) => ({
  issues: [],
  openAtLogin: false,
  preferences: { ...defaultDesktopPreferences(), menuBar },
  revision: 1,
});

export const commandCatalogFixture = (
  native = true,
  query = "",
  theme: AppModel["settings"]["theme"] = "light"
): AppModel => {
  const base = keyboardFixture();

  const notice = native
    ? DesktopNotice.cases.Settings.make({
        settings: commandCatalogSettings(),
      })
    : DesktopNotice.cases.Finished.make({
        outcome: DesktopOutcome.cases.Unavailable.make({}),
        request: base.desktop.request,
      });

  const observed = update(base, Message.ReceivedDesktop({ notice })).model;

  const opened = update(
    observed,
    Message.KeyboardAction({ id: "commands" })
  ).model;

  const filtered = update(opened, Message.KeyboardQuery({ query })).model;

  return { ...filtered, settings: { ...filtered.settings, theme } };
};
