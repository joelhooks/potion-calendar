import { Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { DesktopUi } from "../client/desktop/model.js";
import {
  desktopBusy,
  desktopChoice,
  desktopStatus,
} from "./desktop-settings-controls.js";
import type { DesktopSettingsActions } from "./desktop-settings-controls.js";

export const desktopGeneralRows = <Message>(
  state: typeof DesktopUi.Type,
  h: HtmlBuilder<Message>,
  actions: DesktopSettingsActions<Message>
): readonly Html[] =>
  state.availability === "available"
    ? [
        h.section(
          [h.Class("settings-section")],
          [
            h.h2([], ["System startup"]),
            ...desktopStatus(state, h, actions),
            ...Option.match(AsyncData.getData(state.settings), {
              onNone: () => [],
              onSome: (data) => [
                desktopChoice(
                  h,
                  "desktop-open-calendar",
                  "Open calendar",
                  data.openAtLogin ? "on" : "off",
                  [
                    ["on", "On"],
                    ["off", "Off"],
                  ],
                  desktopBusy(state),
                  (choice) => actions.startup(choice === "on"),
                  actions.rejected
                ),
              ],
            }),
          ]
        ),
      ]
    : [];

export const desktopNotificationRows = <Message>(
  state: typeof DesktopUi.Type,
  h: HtmlBuilder<Message>,
  actions: DesktopSettingsActions<Message>
): readonly Html[] =>
  state.availability === "available"
    ? [
        h.section(
          [h.Class("settings-section")],
          [
            h.h2([], ["Upcoming meetings"]),
            ...desktopStatus(state, h, actions),
            ...Option.match(AsyncData.getData(state.settings), {
              onNone: () => [],
              onSome: ({ preferences }) => [
                desktopChoice(
                  h,
                  "desktop-prompt-minutes",
                  "Show upcoming meeting notification",
                  preferences.promptMinutes,
                  [
                    [null, "No notification"],
                    [0, "At start"],
                    [1, "1 minute before"],
                    [2, "2 minutes before"],
                    [3, "3 minutes before"],
                    [5, "5 minutes before"],
                  ],
                  desktopBusy(state) || !preferences.menuBar,
                  (promptMinutes) =>
                    actions.preferences({ ...preferences, promptMinutes }),
                  actions.rejected
                ),
              ],
            }),
          ]
        ),
      ]
    : [];
