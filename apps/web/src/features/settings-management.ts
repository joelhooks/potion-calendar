import type { CalendarValue } from "@calendar/calendar/contracts";
import { Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../client/app.js";
import type { AppModel, AppMessage } from "../client/app.js";
import { calendarKey } from "../client/calendar-state.js";
import { PrepareAccountRemoval } from "../client/settings-management/dialog.js";
import {
  ManagementChange,
  RemovalState,
} from "../client/settings-management/model.js";
import type {
  ManagementProblem,
  SettingsManagementValue,
} from "../client/settings-management/model.js";
import { PrepareColourPicker } from "../client/settings-management/picker.js";
import {
  calendarPalette,
  colourPending,
} from "../client/settings-management/projection.js";

export const removedAccount = (
  state: SettingsManagementValue,
  h: HtmlBuilder<AppMessage>,
  accountId: string
): readonly Html[] =>
  RemovalState.guards.Removed(state.removal) &&
  state.removal.result.accountId === accountId
    ? [
        h.h1([], ["Account removed"]),
        h.p([h.Role("status")], [state.removal.result.instruction]),
        h.a(
          [h.Href("https://myaccount.google.com/connections")],
          ["Manage third-party access in your Google Account"]
        ),
      ]
    : [];

const removalFeedback = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>,
  info: {
    readonly last: boolean;
    readonly colourWriting: boolean;
    readonly failed: typeof ManagementProblem.Type | undefined;
    readonly accountId: string;
  }
): readonly Html[] => [
  ...(info.last
    ? [
        h.p(
          [h.Id("settings-removal-reason"), h.Class("muted")],
          ["Add another Google account before removing this one."]
        ),
      ]
    : []),
  ...(info.colourWriting
    ? [
        h.p(
          [h.Role("status")],
          ["Wait for the calendar color change to finish."]
        ),
      ]
    : []),
  ...(info.failed === undefined || info.failed.kind === "lastAccount"
    ? []
    : [h.p([h.Role("alert")], [info.failed.message])]),
  ...(Option.isSome(AsyncData.getError(model.calendar.index))
    ? [
        h.button(
          [h.OnClick(Message.ClickedRetry({ accountId: info.accountId }))],
          ["Refresh accounts"]
        ),
      ]
    : []),
];

export const accountRemoval = (
  model: AppModel,
  state: SettingsManagementValue,
  h: HtmlBuilder<AppMessage>,
  account: { readonly id: string; readonly email: string }
): readonly Html[] => {
  const accounts =
    Option.getOrUndefined(AsyncData.getData(model.session))?.accounts ?? [];

  const working = RemovalState.guards.Working(state.removal);

  const colourWriting = state.colours.some(
    (task) => task.accountId === account.id
  );

  const failed =
    RemovalState.guards.Failed(state.removal) &&
    state.removal.accountId === account.id
      ? state.removal.problem
      : undefined;

  const last = accounts.length <= 1 || failed?.kind === "lastAccount";

  const dialogAccount = RemovalState.guards.Confirming(state.removal)
    ? state.removal.accountId
    : undefined;

  const open =
    dialogAccount === account.id ||
    (working && state.removal.task.accountId === account.id);

  return [
    h.section(
      [h.Class("settings-section settings-remove")],
      [
        h.h2([], ["Remove account"]),
        h.p(
          [],
          [
            "Forget this account in Calendar. This does not revoke its Google access.",
          ]
        ),
        h.button(
          [
            h.OnClick(
              Message.ChangedSettingsManagement({
                change: ManagementChange.cases.Remove.make({
                  accountId: account.id,
                }),
              })
            ),
            h.Disabled(last || working || colourWriting),
            ...(last ? [h.AriaDescribedBy("settings-removal-reason")] : []),
          ],
          ["Remove account"]
        ),
        ...removalFeedback(model, h, {
          accountId: account.id,
          colourWriting,
          failed,
          last,
        }),
      ]
    ),
    ...(open
      ? [
          h.keyed("dialog")(
            account.id,
            [
              h.Id("settings-removal-dialog"),
              h.Class("settings-removal-dialog"),
              h.AriaLabel("Remove Google account"),
              h.OnMount(PrepareAccountRemoval()),
              h.OnCancelPreventDefault(
                Message.ChangedSettingsManagement({
                  change: ManagementChange.cases.CancelRemoval.make({}),
                })
              ),
            ],
            [
              h.h2([], ["Remove account?"]),
              h.p([], [h.strong([], [account.email])]),
              h.p(
                [],
                [
                  "Calendar will forget this account here. Its calendars will disappear from this app. This does not revoke Google access.",
                ]
              ),
              h.div(
                [h.Class("settings-dialog-actions")],
                [
                  h.button(
                    [
                      h.Id("settings-removal-cancel"),
                      h.Disabled(working),
                      h.OnClick(
                        Message.ChangedSettingsManagement({
                          change: ManagementChange.cases.CancelRemoval.make({}),
                        })
                      ),
                    ],
                    ["Cancel"]
                  ),
                  h.button(
                    [
                      h.AriaLabel("Confirm remove account"),
                      h.Disabled(working || last || colourWriting),
                      h.OnClick(
                        Message.ChangedSettingsManagement({
                          change: ManagementChange.cases.ConfirmRemoval.make({
                            accountId: account.id,
                          }),
                        })
                      ),
                    ],
                    [working ? "Removing…" : "Remove account"]
                  ),
                ]
              ),
              ...(working
                ? [
                    h.p(
                      [h.Role("status")],
                      ["Removing this account from Calendar…"]
                    ),
                  ]
                : []),
            ]
          ),
        ]
      : []),
  ];
};

export const calendarAppearance = (
  model: AppModel,
  state: SettingsManagementValue,
  h: HtmlBuilder<AppMessage>,
  calendar: CalendarValue
): readonly Html[] => {
  const palette = calendarPalette(
    Option.getOrUndefined(AsyncData.getData(model.calendar.index)),
    calendar.accountId
  );

  const busy = colourPending(state, calendar);

  const open =
    Option.isSome(state.picker) &&
    state.picker.value.accountId === calendar.accountId &&
    state.picker.value.calendarId === calendar.calendarId;

  const problem = state.colourProblems.find(
    (entry) =>
      entry.accountId === calendar.accountId &&
      entry.calendarId === calendar.calendarId
  )?.problem;

  const ref = {
    accountId: calendar.accountId,
    calendarId: calendar.calendarId,
  };

  return [
    h.label(
      [h.Class("settings-visibility")],
      [
        h.input([
          h.Type("checkbox"),
          h.AriaLabel(`Show events from ${calendar.title}`),
          h.Checked(
            !model.calendar.hidden.includes(
              calendarKey(calendar.accountId, calendar.calendarId)
            )
          ),
          h.OnChange(() => Message.ClickedCalendar(ref)),
        ]),
        "Show events",
      ]
    ),
    ...(calendar.hidden === true
      ? [h.span([h.Class("muted")], ["Hidden in Google"])]
      : []),
    h.div(
      [h.Class("settings-colour-control")],
      [
        h.button(
          [
            h.Class("settings-colour-trigger"),
            h.AriaLabel(`Choose color for ${calendar.title}`),
            h.Disabled(busy || Object.keys(palette).length === 0),
            h.AriaExpanded(open),
            h.OnClick(
              Message.ChangedSettingsManagement({
                change: open
                  ? ManagementChange.cases.ClosePicker.make({ ref })
                  : ManagementChange.cases.OpenPicker.make(ref),
              })
            ),
          ],
          ["Color"]
        ),
        ...(busy ? [h.span([h.Role("status")], ["Saving color…"])] : []),
        ...(open
          ? [
              h.keyed("div")(
                calendarKey(calendar.accountId, calendar.calendarId),
                [
                  h.Class("settings-colour-picker"),
                  h.OnMount(PrepareColourPicker(ref)),
                  h.Role("group"),
                  h.AriaLabel(`Calendar colors for ${calendar.title}`),
                ],
                [
                  ...Object.entries(palette).map(([colorId, colour]) =>
                    h.keyed("button")(
                      colorId,
                      [
                        h.AriaLabel(`Color ${colorId}`),
                        h.AriaPressed(String(calendar.colorId === colorId)),
                        h.Title(`Color ${colorId}: ${colour.background}`),
                        h.Style({
                          background: colour.background,
                          color: colour.foreground,
                        }),
                        h.OnClick(
                          Message.ChangedSettingsManagement({
                            change: ManagementChange.cases.ChooseColour.make({
                              ...ref,
                              colorId,
                            }),
                          })
                        ),
                      ],
                      [calendar.colorId === colorId ? "✓" : ""]
                    )
                  ),
                  h.button(
                    [
                      h.Class("settings-colour-close"),
                      h.OnClick(
                        Message.ChangedSettingsManagement({
                          change: ManagementChange.cases.ClosePicker.make({
                            ref,
                          }),
                        })
                      ),
                    ],
                    ["Close"]
                  ),
                ]
              ),
            ]
          : []),
      ]
    ),
    ...(problem === undefined
      ? []
      : [h.p([h.Role("alert")], [problem.message])]),
  ];
};
