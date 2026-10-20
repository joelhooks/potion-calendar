import {
  GlobalShortcut,
  defaultDesktopPreferences,
} from "@calendar/core/desktop-bridge";
import type { DesktopPreferencesValue } from "@calendar/core/desktop-bridge";
import { Option, Schema } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { DesktopUi } from "../client/desktop/model.js";
import { SettingsRoute, printRoute } from "../layout/route.js";
import {
  desktopBusy,
  desktopChoice,
  desktopStatus,
} from "./desktop-settings-controls.js";
import type { DesktopSettingsActions } from "./desktop-settings-controls.js";

const shortcutRow = <Message>(
  h: HtmlBuilder<Message>,
  preferences: DesktopPreferencesValue,
  field: "menuShortcut" | "joinShortcut",
  label: string,
  disabled: boolean,
  actions: DesktopSettingsActions<Message>
): Html =>
  h.div(
    [h.Class("desktop-shortcut-setting")],
    [
      h.div(
        [h.Class("settings-row desktop-shortcut-row")],
        [
          h.label([h.For(`desktop-${field}`)], [label]),
          h.div(
            [h.Class("desktop-shortcut-controls")],
            [
              h.input([
                h.Id(`desktop-${field}`),
                h.Type("text"),
                h.Value(preferences[field] ?? ""),
                h.Disabled(disabled),
                h.OnChange((raw) =>
                  Option.match(
                    Schema.decodeOption(GlobalShortcut)(
                      raw === "" ? null : raw
                    ),
                    {
                      onNone: () =>
                        actions.rejected(
                          "Use a key with modifiers, or clear the shortcut."
                        ),
                      onSome: (value) =>
                        actions.preferences({ ...preferences, [field]: value }),
                    }
                  )
                ),
              ]),
              h.button(
                [
                  h.Type("button"),
                  h.Disabled(disabled || preferences[field] === null),
                  h.OnClick(
                    actions.preferences({ ...preferences, [field]: null })
                  ),
                ],
                ["Unset"]
              ),
              h.button(
                [
                  h.Type("button"),
                  h.Disabled(disabled),
                  h.OnClick(
                    actions.preferences({
                      ...preferences,
                      [field]: defaultDesktopPreferences()[field],
                    })
                  ),
                ],
                ["Restore default"]
              ),
            ]
          ),
        ]
      ),
    ]
  );

export const desktopMenuRows = <Message>(
  state: typeof DesktopUi.Type,
  h: HtmlBuilder<Message>,
  actions: DesktopSettingsActions<Message>
): readonly Html[] => {
  if (state.availability === "unavailable") {
    return [
      h.h1([], ["Menu bar"]),
      h.p([], ["Menu bar settings are available in the desktop app."]),
    ];
  }

  return [
    h.h1([], ["Menu bar"]),
    ...Option.match(AsyncData.getData(state.settings), {
      onNone: () => desktopStatus(state, h, actions),
      onSome: ({ preferences }) => {
        const busy = desktopBusy(state);
        const disabled = busy || !preferences.menuBar;

        const choice = (
          field:
            | "includeAllDay"
            | "includeWithoutParticipants"
            | "includeWithoutConferencingOrLocation"
            | "showTitle"
            | "showTime",
          label: string
        ) =>
          desktopChoice(
            h,
            `desktop-${field}`,
            label,
            preferences[field] ? "on" : "off",
            [
              ["on", "On"],
              ["off", "Off"],
            ],
            disabled,
            (value) =>
              actions.preferences({ ...preferences, [field]: value === "on" }),
            actions.rejected
          );

        return [
          h.section(
            [h.Class("settings-section")],
            [
              desktopChoice(
                h,
                "desktop-menu-bar",
                "Menu bar calendar",
                preferences.menuBar ? "on" : "off",
                [
                  ["on", "On"],
                  ["off", "Off"],
                ],
                busy,
                (value) =>
                  actions.preferences({
                    ...preferences,
                    menuBar: value === "on",
                  }),
                actions.rejected
              ),
              desktopChoice(
                h,
                "desktop-include-days",
                "Include events",
                preferences.includeDays,
                [
                  [1, "1 day"],
                  [2, "2 days"],
                  [3, "3 days"],
                  [4, "4 days"],
                  [5, "5 days"],
                  [6, "6 days"],
                  [7, "7 days"],
                  [14, "14 days"],
                  [30, "30 days"],
                ],
                disabled,
                (includeDays) =>
                  actions.preferences({ ...preferences, includeDays }),
                actions.rejected
              ),
              choice("includeAllDay", "All-day events"),
              choice(
                "includeWithoutParticipants",
                "Events without participants"
              ),
              choice(
                "includeWithoutConferencingOrLocation",
                "Events without conferencing or location"
              ),
              desktopChoice(
                h,
                "desktop-preview-minutes",
                "Preview upcoming event in menu bar",
                preferences.previewMinutes,
                [
                  [0, "At start"],
                  [15, "15 minutes before"],
                  [30, "30 minutes before"],
                  [60, "1 hour before"],
                  [240, "4 hours before"],
                  [480, "8 hours before"],
                  [720, "12 hours before"],
                  [1440, "24 hours before"],
                  [10_080, "Always"],
                ],
                disabled || (!preferences.showTitle && !preferences.showTime),
                (previewMinutes) =>
                  actions.preferences({ ...preferences, previewMinutes }),
                actions.rejected
              ),
              choice("showTitle", "Event title"),
              choice("showTime", "Event time"),
              shortcutRow(
                h,
                preferences,
                "menuShortcut",
                "Show or hide menu bar calendar",
                disabled,
                actions
              ),
              shortcutRow(
                h,
                preferences,
                "joinShortcut",
                "Join upcoming meeting",
                disabled,
                actions
              ),
              h.div(
                [h.Class("desktop-shortcut-status")],
                desktopStatus(state, h, actions)
              ),
              h.a(
                [h.Href(printRoute(SettingsRoute.make({ page: "general" })))],
                ["System startup settings in General"]
              ),
            ]
          ),
        ];
      },
    }),
  ];
};
