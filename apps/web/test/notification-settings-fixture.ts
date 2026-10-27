import {
  defaultDesktopPreferences,
  NotificationSettingsReply,
} from "@calendar/core/desktop-bridge";
import { Match } from "effect";

import type { AppModel } from "../src/client/app.js";
import { RemoteDesktop, initialDesktop } from "../src/client/desktop/model.js";
import {
  RemoteMacNotificationPermission,
  RemoteNotificationSettingsOperation,
} from "../src/client/desktop/notification-model.js";
import { SettingsRoute } from "../src/layout/route.js";
import { fixtureModel } from "./fixture.js";

export const notificationSettingsFixture = (
  scene:
    | "unknown"
    | "menu-off"
    | "pending"
    | "failed"
    | "granted"
    | "denied"
    | "default" = "unknown"
): AppModel => {
  const base = fixtureModel();

  const browser =
    scene === "granted" || scene === "denied" || scene === "default";

  return {
    ...base,
    desktop: browser
      ? { ...initialDesktop(), availability: "unavailable" }
      : {
          ...initialDesktop(),
          availability: "available",
          notificationSettings: {
            action: scene === "pending" || scene === "failed" ? "Open" : "Read",
            operation: Match.value(scene).pipe(
              Match.when("pending", () =>
                RemoteNotificationSettingsOperation.Loading()
              ),
              Match.when("failed", () =>
                RemoteNotificationSettingsOperation.Failure({
                  error:
                    "System Settings could not be requested. Use the Apple menu to open Notifications.",
                })
              ),
              Match.orElse(() =>
                RemoteNotificationSettingsOperation.Success({
                  data: NotificationSettingsReply.cases.Read.make({
                    permission: { authorization: "unknown", supported: true },
                    version: 1,
                  }),
                })
              )
            ),
            permission: RemoteMacNotificationPermission.Success({
              data: { authorization: "unknown", supported: true },
            }),
            request: 1,
          },
          settings: RemoteDesktop.Success({
            data: {
              issues: [],
              openAtLogin: false,
              preferences: {
                ...defaultDesktopPreferences(),
                menuBar: scene !== "menu-off",
              },
              revision: 1,
            },
          }),
        },
    reminders: {
      ...base.reminders,
      context: {
        ...base.reminders.context,
        permission: browser ? scene : base.reminders.context.permission,
      },
    },
    route: SettingsRoute.make({ page: "notifications" }),
  };
};
