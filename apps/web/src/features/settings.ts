import { Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../client/app.js";
import type { AppModel, AppMessage } from "../client/app.js";
import {
  AccountSettingsRoute,
  CalendarRoute,
  SettingsRoute,
  printRoute,
} from "../layout/route.js";
import { desktopSettingsView } from "./desktop-settings-actions.js";
import { desktopMenuRows } from "./desktop-settings-menu.js";
import { settingsCalendars } from "./settings-calendars.js";
import { settingsConferencing } from "./settings-conferencing.js";
import { settingsGeneral } from "./settings-general.js";
import { settingsNotifications } from "./settings-notifications.js";
import { settingsProfile } from "./settings-profile.js";

export const settingsPage = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>,
  page:
    | "general"
    | "calendars"
    | "calendar"
    | "notifications"
    | "menu-bar"
    | "conferencing"
    | "profile",
  accountId?: string
): Html => {
  const accounts =
    Option.getOrUndefined(AsyncData.getData(model.session))?.accounts ?? [];

  const label = {
    calendar: "Calendar settings",
    calendars: "Calendar settings",
    conferencing: "Conferencing settings",
    general: "General settings",
    "menu-bar": "Menu bar settings",
    notifications: "Notification settings",
    profile: "Profile settings",
  }[page];

  const content = () => {
    if (page === "menu-bar") {
      return desktopSettingsView(model.desktop, h, desktopMenuRows);
    }

    if (page === "general") {
      return settingsGeneral(model, h);
    }

    if (page === "conferencing") {
      return settingsConferencing(model, h);
    }

    if (page === "profile") {
      return settingsProfile(model, h);
    }

    if (page === "notifications") {
      return settingsNotifications(model, h);
    }

    return page === "calendar" && accountId !== undefined
      ? settingsCalendars(model, h, accountId)
      : [h.p([h.Role("status")], ["Opening calendar settings…"])];
  };

  return h.div(
    [
      h.Class("settings-shell"),
      h.OnKeyDownPreventDefault((key) =>
        key === "Escape"
          ? Option.some(
              Message.RequestedRoute({
                replace: true,
                route: CalendarRoute.make({}),
              })
            )
          : Option.none()
      ),
    ],
    [
      h.nav(
        [h.Class("settings-nav"), h.AriaLabel("Settings")],
        [
          h.button([h.OnClick(Message.RequestedRouteBack())], ["← Calendar"]),
          h.a(
            [
              h.Href(printRoute(SettingsRoute.make({ page: "general" }))),
              h.AriaCurrent(page === "general" ? "page" : "false"),
            ],
            ["General"]
          ),
          h.a(
            [
              h.Href(printRoute(SettingsRoute.make({ page: "calendars" }))),
              h.AriaCurrent(page === "calendars" ? "page" : "false"),
            ],
            ["Calendars"]
          ),
          h.a(
            [
              h.Href(printRoute(SettingsRoute.make({ page: "notifications" }))),
              h.AriaCurrent(page === "notifications" ? "page" : "false"),
            ],
            ["Notifications"]
          ),
          h.a(
            [
              h.Href(printRoute(SettingsRoute.make({ page: "conferencing" }))),
              h.AriaCurrent(page === "conferencing" ? "page" : "false"),
            ],
            ["Conferencing"]
          ),
          h.a(
            [
              h.Href(printRoute(SettingsRoute.make({ page: "profile" }))),
              h.AriaCurrent(page === "profile" ? "page" : "false"),
            ],
            ["Profile"]
          ),
          ...(model.desktop.availability === "available"
            ? [
                h.a(
                  [
                    h.Href(
                      printRoute(SettingsRoute.make({ page: "menu-bar" }))
                    ),
                    h.AriaCurrent(page === "menu-bar" ? "page" : "false"),
                  ],
                  ["Menu bar"]
                ),
              ]
            : []),
          ...accounts.map((account) =>
            h.a(
              [
                h.Class("settings-account-nav"),
                h.Href(
                  printRoute(
                    AccountSettingsRoute.make({ accountId: account.id })
                  )
                ),
                h.AriaCurrent(
                  page === "calendar" && accountId === account.id
                    ? "page"
                    : "false"
                ),
              ],
              [account.email]
            )
          ),
        ]
      ),
      h.section([h.Class("settings-content"), h.AriaLabel(label)], content()),
    ]
  );
};
