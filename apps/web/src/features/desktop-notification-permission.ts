import {
  deskDefaultMacNotificationGuidance,
  deskDefaultMacNotificationPermission,
  deskDefaultMacNotificationSettingsUrl,
} from "@calendar/core/desktop-bridge";
import { Option, Predicate } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../client/app.js";
import type { AppModel, AppMessage } from "../client/app.js";
import {
  NotificationSettingsChange,
  initialNotificationSettings,
} from "../client/desktop/notification-model.js";

export const desktopNotificationPermission = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): Html => {
  const state =
    model.desktop.notificationSettings ?? initialNotificationSettings();

  const permission = AsyncData.getData(state.permission);
  const busy = Predicate.isTagged(state.operation, "Loading");
  const operation = AsyncData.getData(state.operation);

  return h.section(
    [h.Class("settings-section"), h.AriaLabel("macOS notifications")],
    [
      h.h2([], ["macOS notifications"]),
      h.div(
        [h.Class("settings-conferencing-entry")],
        [
          h.p(
            [h.Id("desktop-notification-permission")],
            [deskDefaultMacNotificationPermission.text]
          ),
          h.p(
            [h.Class("muted")],
            [deskDefaultMacNotificationPermission.explanation]
          ),
          ...(Option.exists(permission, (value) => !value.supported)
            ? [
                h.p(
                  [h.Role("status")],
                  [
                    "Native notifications are unavailable in this desktop build.",
                  ]
                ),
              ]
            : []),
          h.div(
            [h.Class("settings-calendar-actions")],
            [
              h.button(
                [
                  h.Id("desktop-notification-settings-open"),
                  h.Disabled(busy || Option.isNone(permission)),
                  h.OnClick(
                    Message.ChangedDesktopNotificationSettings({
                      change: NotificationSettingsChange.cases.Open.make({}),
                    })
                  ),
                ],
                [
                  busy && state.action === "Open"
                    ? "Requesting System Settings…"
                    : "Open System Settings",
                ]
              ),
              ...(!busy && Option.isNone(permission)
                ? [
                    h.button(
                      [
                        h.Id("desktop-notification-settings-read"),
                        h.OnClick(
                          Message.ChangedDesktopNotificationSettings({
                            change: NotificationSettingsChange.cases.Read.make(
                              {}
                            ),
                          })
                        ),
                      ],
                      ["Check desktop status"]
                    ),
                  ]
                : []),
            ]
          ),
          ...(busy && state.action === "Read"
            ? [
                h.p(
                  [h.Role("status")],
                  ["Checking desktop notification support…"]
                ),
              ]
            : []),
          ...(Predicate.isTagged(state.operation, "Failure")
            ? [h.p([h.Role("alert")], [state.operation.error])]
            : []),
          ...(Option.exists(operation, (value) =>
            Predicate.isTagged(value, "Requested")
          )
            ? [
                h.p(
                  [h.Role("status")],
                  [
                    "System Settings was requested. Check the Notifications pane.",
                  ]
                ),
              ]
            : []),
          ...(Option.exists(operation, (value) =>
            Predicate.isTagged(value, "Unavailable")
          )
            ? [
                h.p(
                  [h.Role("status")],
                  [
                    "The System Settings control is unavailable in this desktop build.",
                  ]
                ),
              ]
            : []),
          h.div(
            [h.Class("settings-conferencing-entry")],
            [
              h.p(
                [h.Class("muted")],
                [deskDefaultMacNotificationSettingsUrl.fallback]
              ),
              h.p([], [deskDefaultMacNotificationGuidance.alerts]),
              h.p([], [deskDefaultMacNotificationGuidance.focus]),
            ]
          ),
        ]
      ),
    ]
  );
};
