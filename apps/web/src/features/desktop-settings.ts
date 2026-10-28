import { deskDefaultMenuBarOffNotificationGuidance } from "@calendar/core/desktop-bridge";
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
                ...(data.macStartup === undefined
                  ? []
                  : [
                      desktopChoice(
                        h,
                        "desktop-start-menu-bar",
                        "Start menu bar calendar",
                        data.macStartup.menuBar ? "on" : "off",
                        [
                          ["on", "On"],
                          ["off", "Off"],
                        ],
                        desktopBusy(state) ||
                          !data.preferences.menuBar ||
                          data.macStartup.calendar,
                        (choice) => actions.startup(choice === "on", "menuBar"),
                        actions.rejected
                      ),
                    ]),
                desktopChoice(
                  h,
                  "desktop-open-calendar",
                  data.macStartup === undefined
                    ? "Open calendar"
                    : "Open calendar window",
                  (data.macStartup?.calendar ?? data.openAtLogin)
                    ? "on"
                    : "off",
                  [
                    ["on", "On"],
                    ["off", "Off"],
                  ],
                  desktopBusy(state),
                  (choice) =>
                    actions.startup(
                      choice === "on",
                      data.macStartup === undefined ? undefined : "calendar"
                    ),
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
                desktopChoice(
                  h,
                  "desktop-prompt-sound",
                  "Play sound for upcoming meeting notification",
                  preferences.promptSound,
                  [
                    ["none", "No sound"],
                    ["blip", "Blip"],
                    ["bell", "Bell"],
                    ["tap", "Tap"],
                  ],
                  desktopBusy(state) ||
                    !preferences.menuBar ||
                    preferences.promptMinutes === null,
                  (promptSound) =>
                    actions.preferences(
                      { ...preferences, promptSound },
                      promptSound !== preferences.promptSound
                    ),
                  actions.rejected
                ),
                ...(preferences.menuBar
                  ? []
                  : [
                      h.p(
                        [h.Role("status")],
                        [deskDefaultMenuBarOffNotificationGuidance.text]
                      ),
                    ]),
              ],
            }),
          ]
        ),
      ]
    : [];
