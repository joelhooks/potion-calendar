import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";
import type { NotificationPermission } from "../client/reminders/model.js";

const permissionLabel = (
  permission: typeof NotificationPermission.Type
): string => {
  if (permission === "granted") {
    return "Browser notifications are allowed. Reminders run while Calendar is open.";
  }

  if (permission === "denied") {
    return "Browser notifications are blocked. Allow notifications in your browser's site settings.";
  }

  return permission === "unsupported"
    ? "This browser does not support notifications."
    : "Browser notifications are not yet enabled.";
};

export const remindersPermission = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): Html =>
  h.section(
    [h.Class("settings-section"), h.Id("browser-notification-permission")],
    [
      h.h2([], ["Browser notifications"]),
      h.div(
        [h.Class("settings-row")],
        [
          h.p(
            [h.Class("muted"), h.Role("status")],
            [
              model.reminders.value === "requesting"
                ? "Waiting for browser permission…"
                : permissionLabel(model.reminders.context.permission),
            ]
          ),
          ...(model.reminders.context.permission === "default"
            ? [
                h.button(
                  [
                    h.Id("enable-reminders"),
                    h.Disabled(
                      model.reminders.value === "requesting" ||
                        Option.isNone(model.person)
                    ),
                    h.OnClick(Message.ClickedEnableReminders()),
                  ],
                  ["Turn on reminders"]
                ),
              ]
            : []),
        ]
      ),
      ...Option.match(model.reminders.failure, {
        onNone: () => [],
        onSome: (failure) => [h.p([h.Role("alert")], [failure])],
      }),
    ]
  );
