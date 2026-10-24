import { DesktopAction } from "@calendar/core/desktop-bridge";
import type { DesktopActionValue } from "@calendar/core/desktop-bridge";
import { Effect } from "effect";
import type { BrowserWindow } from "electron";

import type { DesktopError } from "./config.js";

type MainWindow = Pick<
  BrowserWindow,
  "isMinimized" | "restore" | "show" | "focus"
>;

export const focusMainWindow = (window: MainWindow) => {
  if (window.isMinimized()) {
    window.restore();
  }

  window.show();
  window.focus();
};

export const mainWindowActions = (
  focus: () => void,
  pageAction: (action: DesktopActionValue) => Effect.Effect<void, DesktopError>
) => ({
  open: () => Effect.sync(focus),
  settings: (page: typeof DesktopAction.cases.OpenSettings.fields.page.Type) =>
    Effect.sync(focus).pipe(
      Effect.andThen(
        pageAction(DesktopAction.cases.OpenSettings.make({ page }))
      )
    ),
});
