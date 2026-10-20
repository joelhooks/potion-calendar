import { googleCalendarCapabilities } from "@calendar/calendar/contracts";
import { Option, Predicate } from "effect";
import { AsyncData } from "foldkit";
import type { Document, Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../client/app.js";
import type { AppModel, AppMessage } from "../client/app.js";
import { PrepareClipboardDialogs } from "../client/clipboard/dialog-mount.js";
import { PrepareEditingDialogs } from "../client/editing/dialog-mount.js";
import { EditorView } from "../client/editing/editor-model.js";
import { PrepareGestures } from "../client/editing/gesture-mount.js";
import { PrepareKeyboard } from "../client/keyboard/mount.js";
import { bindingHints } from "../client/keyboard/registry.js";
import { resolvedTheme } from "../client/settings/model.js";
import { homeZone } from "../client/time-zones/model.js";
import { visibleDays } from "../layout/navigation.js";
import { resolvedTimeFormat } from "../layout/time-format.js";
import { detailPanel, sidebar, systemZonePrompt, toolbar } from "./calendar.js";
import { clipboardPanel } from "./clipboard.js";
import { commandMenu } from "./command-menu.js";
import { conferencingSaveNotice } from "./conferencing-save-notice.js";
import { editorDialogs } from "./event-editor.js";
import { searchPanel } from "./search.js";
import { settingsPage } from "./settings.js";
import { shortcutsPage } from "./shortcuts-page.js";
import { monthGrid, timeGrid } from "./time-grid.js";
import { undoToast } from "./undo-toast.js";
import { upcomingMeetingPanel } from "./upcoming-meeting.js";

const editingLayers = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  const latest = model.editing.deletes.findLast(
    (mark) => mark.phase === "pending"
  );

  const send = (
    action: Parameters<typeof Message.EditingAction>[0]["action"]
  ): AppMessage =>
    Message.EditingAction({
      action,
      personId: Option.getOrUndefined(model.person),
    });

  const toast =
    latest === undefined
      ? undefined
      : undoToast(h, { intent: latest.intent, send });

  return [
    ...editorDialogs(h, {
      calendars: model.calendar.calendars,
      chooseTimeZone: Message.KeyboardAction({ id: "event-zone" }),
      initialFocus: model.keyboard.focus,
      model: model.editing.view,
      primaryZone: homeZone(model),
      reminderLimit: googleCalendarCapabilities.maxRemindersCount,
      send,
      theme: resolvedTheme(model),
      timeFormat: resolvedTimeFormat(model),
      toast,
    }),
  ];
};

const notificationLayers = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  const latest = model.editing.deletes.findLast(
    (mark) => mark.phase === "pending"
  );

  const clipboardReady =
    Option.isSome(model.person) && Option.isSome(model.clipboard.sessionId);

  const undoReady =
    EditorView.guards.Closed(model.editing.view) && latest !== undefined;

  if (
    Option.isNone(model.editing.conferencingResult) &&
    !clipboardReady &&
    !undoReady
  ) {
    return [];
  }

  const send = (
    action: Parameters<typeof Message.EditingAction>[0]["action"]
  ): AppMessage =>
    Message.EditingAction({
      action,
      personId: Option.getOrUndefined(model.person),
    });

  return [
    h.div(
      [
        h.Class("notification-stack"),
        h.Style({
          "align-items": "flex-end",
          bottom: "24px",
          display: "flex",
          "flex-direction": "column",
          gap: "12px",
          "max-width": "min(460px, calc(100vw - 48px))",
          position: "fixed",
          right: "24px",
          "z-index": "800",
        }),
      ],
      [
        ...Option.match(model.editing.conferencingResult, {
          onNone: () => [],
          onSome: (notice) => [conferencingSaveNotice(h, notice, send)],
        }),
        ...(Option.isSome(model.person) &&
        Option.isSome(model.clipboard.sessionId)
          ? [
              h.div(
                [
                  h.Style({ display: "contents" }),
                  h.OnMount(
                    PrepareClipboardDialogs({
                      personId: model.person.value,
                      sessionId: model.clipboard.sessionId.value,
                    })
                  ),
                ],
                [
                  clipboardPanel(
                    h,
                    model.clipboard.view,
                    (action) =>
                      Message.ClipboardAction({
                        action,
                        personId: Option.getOrElse(model.person, () => ""),
                        sessionId: Option.getOrElse(
                          model.clipboard.sessionId,
                          () => ""
                        ),
                      }),
                    true
                  ),
                ]
              ),
            ]
          : []),
        ...(undoReady && latest !== undefined
          ? [undoToast(h, { intent: latest.intent, send, stacked: true })]
          : []),
      ]
    ),
  ];
};

const dateFlash = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  if (Option.isNone(model.keyboard.flash)) {
    return [];
  }

  const day = model.keyboard.flash.value;
  const index = visibleDays(model.calendar.navigation).indexOf(day) + 1;
  const name = `keyboard-date-flash-${model.keyboard.flashVersion}`;

  return [
    h.style(
      [],
      [
        `@keyframes ${name}{from{background-color:#d8e6ed}to{background-color:transparent}} .day-column[data-day="${day}"],.month-cells .month-cell:nth-child(${index}){animation:${name} 1s ease-out}`,
      ]
    ),
  ];
};

const pageToolbar = (model: AppModel, h: HtmlBuilder<AppMessage>): Html =>
  Predicate.isTagged(model.route, "Settings")
    ? h.header([h.Class("toolbar")], [h.h1([], ["Calendar"])])
    : toolbar(model, h);

const workspaceContent = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>,
  prepare: typeof PrepareGestures
): Html => {
  if (Predicate.isTagged(model.route, "Search")) {
    return searchPanel(model, h);
  }

  return model.calendar.navigation.mode === "month"
    ? monthGrid(model, h)
    : timeGrid(model, h, prepare);
};

const routedPage = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>,
  prepare: typeof PrepareGestures
): Html => {
  if (Predicate.isTagged(model.route, "Shortcuts")) {
    return shortcutsPage(model, h);
  }

  if (Predicate.isTagged(model.route, "Settings")) {
    return model.route.page === "calendar"
      ? settingsPage(model, h, "calendar", model.route.accountId)
      : settingsPage(model, h, model.route.page);
  }

  return h.div(
    [h.Class("workspace")],
    [
      ...(model.keyboard.sidebar ? [sidebar(model, h)] : []),
      workspaceContent(model, h, prepare),
      ...(model.settings.hideContextPanel
        ? []
        : [...detailPanel(model, h), ...upcomingMeetingPanel(model, h)]),
    ]
  );
};

export const view = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>,
  prepare: typeof PrepareGestures = PrepareGestures
): Document => ({
  body: h.keyed("main")(
    Option.getOrElse(model.person, () => "signed-out"),
    [
      h.Class(`app theme-${resolvedTheme(model)}`),
      h.OnMount(PrepareKeyboard()),
    ],
    [
      ...AsyncData.match(model.session, {
        onFailure: (error) => [
          h.section(
            [h.Class("auth-shell")],
            [h.h1([], ["Calendar"]), h.p([h.Role("alert")], [error])]
          ),
        ],
        onIdle: () => [
          h.p(
            [h.Class("auth-shell"), h.Role("status")],
            ["Loading your accounts…"]
          ),
        ],
        onLoading: () => [
          h.p(
            [h.Class("auth-shell"), h.Role("status")],
            ["Loading your accounts…"]
          ),
        ],
        onRefreshing: () => [
          h.p(
            [h.Class("auth-shell"), h.Role("status")],
            ["Loading your accounts…"]
          ),
        ],
        onStale: ({ error }) => [
          h.p([h.Class("auth-shell"), h.Role("alert")], [error]),
        ],
        onSuccess: (data) =>
          data === null
            ? [
                h.section(
                  [h.Class("auth-shell")],
                  [
                    h.h1([], ["Calendar"]),
                    h.p([], ["Your Google calendars, in one place."]),
                    h.button(
                      [
                        h.OnClick(Message.ClickedSignIn()),
                        h.Disabled(model.action === "pending"),
                      ],
                      ["Sign in with Google"]
                    ),
                  ]
                ),
              ]
            : [
                pageToolbar(model, h),
                ...(model.keyboard.sidebar
                  ? [
                      h.button(
                        [
                          h.Id("command-menu-button"),
                          h.OnClick(Message.KeyboardAction({ id: "commands" })),
                          h.Style({
                            bottom: "16px",
                            left: "16px",
                            padding: "8px",
                            position: "fixed",
                            "z-index": "5",
                          }),
                          h.AriaLabel("Open command menu"),
                        ],
                        [`Commands · ${bindingHints("commands").join(" / ")}`]
                      ),
                    ]
                  : []),
                routedPage(model, h, prepare),
                ...systemZonePrompt(model, h),
              ],
      }),
      h.div(
        [
          h.Style({ display: "contents" }),
          h.OnMount(PrepareEditingDialogs({ person: model.person })),
        ],
        editingLayers(model, h)
      ),
      ...notificationLayers(model, h),
      ...commandMenu(model, h),
      ...dateFlash(model, h),
      ...(Option.isNone(model.error)
        ? []
        : [h.p([h.Class("app-error"), h.Role("alert")], [model.error.value])]),
    ]
  ),
  title: "Calendar",
});
