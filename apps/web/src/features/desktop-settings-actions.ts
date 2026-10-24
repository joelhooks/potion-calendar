import type { Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../client/app.js";
import type { AppMessage } from "../client/app.js";
import { DesktopNotice, DesktopRequest } from "../client/desktop/model.js";
import type { DesktopUi } from "../client/desktop/model.js";
import type { DesktopSettingsActions } from "./desktop-settings-controls.js";

export const desktopSettingsView = (
  state: typeof DesktopUi.Type,
  h: HtmlBuilder<AppMessage>,
  rows: (
    state: typeof DesktopUi.Type,
    h: HtmlBuilder<AppMessage>,
    actions: DesktopSettingsActions<AppMessage>
  ) => readonly Html[]
): readonly Html[] => {
  const actions: DesktopSettingsActions<AppMessage> = {
    preferences: (preferences, previewSound) =>
      Message.RequestedDesktop({
        request: DesktopRequest.cases.Save.make({
          preferences,
          previewSound,
          request: state.request + 1,
        }),
      }),
    read: Message.RequestedDesktop({
      request: DesktopRequest.cases.Read.make({ request: state.request + 1 }),
    }),
    rejected: (message) =>
      Message.ReceivedDesktop({
        notice: DesktopNotice.cases.Rejected.make({ message }),
      }),
    startup: (enabled) =>
      Message.RequestedDesktop({
        request: DesktopRequest.cases.Startup.make({
          enabled,
          request: state.request + 1,
        }),
      }),
  };

  return rows(state, h, actions);
};
