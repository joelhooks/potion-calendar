import type { CalendarValue } from "@calendar/calendar/contracts";
import { Match, Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";
import { calendarKey } from "../client/calendar-state.js";
import { writableCalendar } from "../client/editing/load-editor.js";
import { RemovalState } from "../client/settings-management/model.js";
import { SettingsChange } from "../client/settings/model.js";
import { defaultCreationCalendar } from "../client/settings/update.js";
import { accountFailure } from "../layout/presentation.js";
import { AccountSettingsRoute, printRoute } from "../layout/route.js";
import { conferencingAccountSettings } from "./conferencing-account-settings.js";
import {
  accountRemoval,
  calendarAppearance,
  removedAccount,
} from "./settings-management.js";

export const settingsCalendars = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>,
  accountId?: string
): readonly Html[] => {
  const accounts =
    Option.getOrUndefined(AsyncData.getData(model.session))?.accounts ?? [];

  const state = model.settingsManagement;
  const selected = defaultCreationCalendar(model);

  const row = (calendar: CalendarValue, showDefault: boolean): Html => {
    const active =
      selected?.accountId === calendar.accountId &&
      selected.calendarId === calendar.calendarId;

    return h.keyed("div")(
      calendarKey(calendar.accountId, calendar.calendarId),
      [h.Class("settings-calendar-row")],
      [
        h.div(
          [],
          [
            h.strong([], [calendar.title]),
            h.p(
              [h.Class("muted")],
              [
                Match.value(calendar.accessRole).pipe(
                  Match.when("owner", () => "Owner"),
                  Match.when("writer", () => "Can edit"),
                  Match.orElse(() => "Read only")
                ),
              ]
            ),
          ]
        ),
        h.div(
          [h.Class("settings-calendar-actions")],
          [
            ...calendarAppearance(model, state, h, calendar),
            ...(showDefault && writableCalendar(calendar)
              ? [
                  active
                    ? h.span(
                        [h.Class("settings-default"), h.Role("status")],
                        ["Default calendar"]
                      )
                    : h.button(
                        [
                          h.OnClick(
                            Message.ChangedSettings({
                              change: SettingsChange.cases.DefaultCalendar.make(
                                {
                                  value: Option.some({
                                    accountId: calendar.accountId,
                                    calendarId: calendar.calendarId,
                                  }),
                                }
                              ),
                            })
                          ),
                        ],
                        ["Use as default"]
                      ),
                ]
              : []),
          ]
        ),
      ]
    );
  };

  if (accountId === undefined) {
    return [
      h.h1([], ["Calendars"]),
      h.p(
        [h.Class("settings-intro")],
        [
          "Choose which calendars appear here and change their colors. Open an account to set its default calendar or remove the account.",
        ]
      ),
      ...accounts.map((account) =>
        h.keyed("section")(
          account.id,
          [h.Class("settings-section")],
          [
            h.a(
              [
                h.Class("settings-account-link"),
                h.Href(
                  printRoute(
                    AccountSettingsRoute.make({ accountId: account.id })
                  )
                ),
              ],
              [
                h.strong([], [account.email]),
                h.span([h.Class("muted")], ["Google Calendar →"]),
              ]
            ),
            ...model.calendar.calendars
              .filter((calendar) => calendar.accountId === account.id)
              .map((calendar) => row(calendar, false)),
            ...(account.disconnected
              ? [
                  h.p(
                    [h.Class("muted")],
                    ["Reconnect this account to load its calendars."]
                  ),
                ]
              : []),
          ]
        )
      ),
      ...(accounts.length === 0
        ? [h.p([], ["No connected Google accounts."])]
        : []),
    ];
  }

  const removed = removedAccount(state, h, accountId);

  if (removed.length > 0) {
    return removed;
  }

  const account = accounts.find((item) => item.id === accountId);

  if (account === undefined) {
    return [
      h.h1([], ["Account unavailable"]),
      h.p(
        [],
        [
          "This account is not connected. Choose another account from Calendars.",
        ]
      ),
      ...(RemovalState.guards.Failed(state.removal) &&
      state.removal.accountId === accountId
        ? [h.p([h.Role("alert")], [state.removal.problem.message])]
        : []),
    ];
  }

  const calendars = model.calendar.calendars.filter(
    (calendar) => calendar.accountId === accountId
  );

  const failure = accountFailure(model, accountId);
  const reconnect = account.disconnected || failure?.kind === "reconnect";

  const list = (title: string, owned: boolean): Html => {
    const entries = calendars.filter(
      (calendar) => (calendar.accessRole === "owner") === owned
    );

    return h.section(
      [h.Class("settings-section")],
      [
        h.h2([], [title]),
        ...entries.map((calendar) => row(calendar, true)),
        ...(entries.length === 0
          ? [h.p([h.Class("muted")], ["No calendars in this group."])]
          : []),
      ]
    );
  };

  return [
    h.h1([], [account.email]),
    h.p([h.Class("settings-intro")], ["Google Calendar"]),
    ...(reconnect
      ? [
          h.p(
            [h.Role("alert")],
            ["Reconnect this account to restore calendar access."]
          ),
        ]
      : []),
    h.button(
      [
        h.OnClick(Message.ClickedAddGoogle()),
        h.Disabled(model.action === "pending"),
      ],
      ["Reconnect"]
    ),
    ...(failure !== undefined && !reconnect
      ? [
          h.p([h.Role("alert")], [failure.message]),
          h.button([h.OnClick(Message.ClickedRetry({ accountId }))], ["Retry"]),
        ]
      : []),
    ...(reconnect ? [] : conferencingAccountSettings(model, h, accountId)),
    ...(reconnect
      ? [
          h.p(
            [h.Class("settings-intro")],
            ["Calendars for this account appear after you reconnect."]
          ),
        ]
      : [
          h.p(
            [h.Class("settings-intro")],
            [
              "New events go to the default calendar. It can be a hidden calendar.",
            ]
          ),
          list("Owned calendars", true),
          list("Subscribed calendars", false),
        ]),
    ...accountRemoval(model, state, h, account),
  ];
};
