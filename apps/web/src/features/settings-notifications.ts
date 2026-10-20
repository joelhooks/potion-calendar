import { Option, Schema } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../client/app.js";
import type { AppModel, AppMessage } from "../client/app.js";
import { SettingsChange } from "../client/settings/model.js";
import { desktopSettingsView } from "./desktop-settings-actions.js";
import { desktopNotificationRows } from "./desktop-settings.js";
import { remindersPermission } from "./reminders-permission.js";

export const settingsNotifications = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => [
  h.h1([], ["Notifications"]),
  remindersPermission(model, h),
  ...desktopSettingsView(model.desktop, h, desktopNotificationRows),
  h.section(
    [h.Class("settings-section")],
    [
      h.h2([], ["Default event reminders"]),
      h.p(
        [],
        [
          "Open Google Calendar Settings, choose Settings for my calendars, then Event notifications to change a calendar's default reminders.",
        ]
      ),
    ]
  ),
  h.section(
    [h.Class("settings-section")],
    [
      h.label(
        [h.Class("settings-row"), h.For("settings-event-invites")],
        [
          h.span([], ["Event invites"]),
          h.select(
            [
              h.Id("settings-event-invites"),
              h.Value(model.settings.eventInvites ? "on" : "off"),
              h.OnChange((value) =>
                Schema.decodeUnknownOption(Schema.Literals(["on", "off"]))(
                  value
                ).pipe(
                  Option.match({
                    onNone: () => Message.SavedPreferences(),
                    onSome: (choice) =>
                      Message.ChangedSettings({
                        change: SettingsChange.cases.EventInvites.make({
                          enabled: choice === "on",
                        }),
                      }),
                  })
                )
              ),
            ],
            [
              h.option(
                [h.Value("on"), h.Selected(model.settings.eventInvites)],
                ["On"]
              ),
              h.option(
                [h.Value("off"), h.Selected(!model.settings.eventInvites)],
                ["Off"]
              ),
            ]
          ),
        ]
      ),
      h.p(
        [h.Class("muted")],
        [
          "Notifications when you receive an invitation or a previously answered invitation changes.",
        ]
      ),
    ]
  ),
];
