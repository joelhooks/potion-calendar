import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../client/app.js";
import type { AppModel, AppMessage } from "../client/app.js";
import { BulkView } from "../client/bulk/model.js";
import type { BulkExecution } from "../client/bulk/model.js";
import {
  bulkSummary,
  settledBulk,
  bulkConferenceNotices,
} from "../client/bulk/selection.js";
import { EditorAction } from "../client/editing/editor-action.js";
import { EditorMutation } from "../client/editing/editor-session-model.js";
import { selectionContext } from "../layout/selection-set.js";
import { conferencingNoticeText } from "./conferencing-save-notice.js";

export const bulkDetail = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>,
  presentation: "panel" | "sheet" = "panel"
): readonly Html[] => {
  const context = selectionContext(model.calendar.selected);

  const busy =
    BulkView.guards.Running(model.editing.bulk) ||
    BulkView.guards.Undoing(model.editing.bulk);

  const send = (action: typeof EditorAction.Type) =>
    Message.EditingAction({
      action,
      personId: Option.getOrUndefined(model.person),
    });

  return [
    h.aside(
      [h.Class("detail-panel bulk-detail"), h.AriaLabel(context.label)],
      [
        ...(presentation === "panel"
          ? [
              h.button(
                [
                  h.Class("close-detail"),
                  h.OnClick(Message.ClosedDetail()),
                  h.AriaLabel("Clear selection"),
                ],
                ["×"]
              ),
              h.h2([], [context.label]),
            ]
          : []),
        h.p(
          [],
          [
            "Changes apply only to these events, not whole repeating series. Copies keep their original times.",
          ]
        ),
        h.div(
          [h.Class("bulk-action-buttons")],
          [
            h.button(
              [
                h.Disabled(busy),
                h.OnClick(send(EditorAction.cases.DuplicateSelected.make({}))),
              ],
              ["Duplicate selected"]
            ),
            h.button(
              [
                h.Disabled(busy),
                h.OnClick(send(EditorAction.cases.DeleteSelected.make({}))),
              ],
              ["Delete selected"]
            ),
          ]
        ),
      ]
    ),
  ];
};

const bulkEmailCopy = (
  execution: typeof BulkExecution.Type,
  succeeded: readonly string[],
  undoing: boolean
): readonly string[] => {
  if (undoing) {
    return [];
  }

  const events = execution.mutations
    .filter(EditorMutation.guards.DeletedStaged)
    .map((mutation) => mutation.intent)
    .filter(
      (intent) =>
        intent.intent === "emailOccurrence" &&
        Option.isSome(intent.selection) &&
        succeeded.includes(intent.selection.value)
    )
    .map((intent) => intent.event);

  const organizer = events.some(
    (event) =>
      event.organizer?.self === true &&
      (event.attendees ?? []).some((person) => person.self !== true)
  );

  const invitation = events.some((event) => event.organizer?.self === false);

  return [
    ...(organizer ? ["Guests will be notified."] : []),
    ...(invitation ? ["Google may email the organizer."] : []),
    ...(events.length > 0 && !organizer && !invitation
      ? ["No email sent."]
      : []),
  ];
};

export const bulkNotice = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  const view = model.editing.bulk;

  if (BulkView.guards.Idle(view)) {
    return [];
  }

  if (BulkView.guards.Running(view)) {
    return [
      h.section(
        [h.Class("bulk-notice"), h.Role("status")],
        [h.p([], ["Applying selected event actions…"])]
      ),
    ];
  }

  const summary = bulkSummary(model);
  const execution = settledBulk(model);

  if (summary === undefined || execution === undefined) {
    return [];
  }

  const verb =
    execution.plan.operation === "duplicate" ? "Duplicated" : "Deleted";

  const count = summary.succeeded.length;

  const issueVerb =
    execution.plan.operation === "duplicate" ? "copy" : "delete";

  const undoing = BulkView.guards.Undoing(view);
  const issues = [...summary.failed, ...summary.skipped];
  const conferences = bulkConferenceNotices(model);

  const emailCopy = bulkEmailCopy(execution, summary.succeeded, undoing);

  return [
    h.section(
      [
        h.Class("bulk-notice"),
        h.Role("status"),
        h.AriaLabel("Bulk action results"),
      ],
      [
        h.h3(
          [],
          [
            undoing
              ? "Undoing selected deletions…"
              : `${verb} ${count} ${count === 1 ? "event" : "events"}`,
          ]
        ),
        ...(issues.length === 0
          ? []
          : [
              h.h4(
                [],
                [
                  `Couldn't ${issueVerb} ${issues.length} ${issues.length === 1 ? "event" : "events"}`,
                ]
              ),
              h.ul(
                [],
                issues.map((issue) =>
                  h.li([], [`${issue.title}: ${issue.reason}`])
                )
              ),
            ]),
        ...emailCopy.map((copy) => h.p([], [copy])),
        ...conferences.map((notice) =>
          h.p([], [`${notice.title}: ${conferencingNoticeText(notice.status)}`])
        ),
        ...(execution.plan.operation === "duplicate" &&
        summary.succeeded.length > 0
          ? [h.p([], ["Copies can't be undone; delete them if needed."])]
          : []),
        ...(execution.plan.operation === "duplicate" ||
        summary.undoUnavailable.length === 0
          ? []
          : [
              h.details(
                [],
                [
                  h.summary(
                    [],
                    [
                      `Undo unavailable for ${summary.undoUnavailable.length} events`,
                    ]
                  ),
                  h.ul(
                    [],
                    summary.undoUnavailable.map((issue) =>
                      h.li([], [`${issue.title}: ${issue.reason}`])
                    )
                  ),
                ]
              ),
            ]),
        h.div(
          [h.Class("bulk-action-buttons")],
          [
            ...(summary.undo.length > 0
              ? [
                  h.button(
                    [
                      h.Disabled(undoing),
                      h.OnClick(
                        Message.BulkControl({
                          control: "undo",
                          personId: Option.getOrUndefined(model.person),
                        })
                      ),
                    ],
                    ["Undo"]
                  ),
                ]
              : []),
            h.button(
              [
                h.Disabled(undoing),
                h.OnClick(
                  Message.BulkControl({
                    control: "dismiss",
                    personId: Option.getOrUndefined(model.person),
                  })
                ),
              ],
              ["Dismiss"]
            ),
          ]
        ),
      ]
    ),
  ];
};

export const selectionRectangle = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  const { rectangle } = model.calendar;

  if (Option.isNone(rectangle)) {
    return [];
  }

  const box = rectangle.value;

  return [
    h.div([
      h.Class("selection-rectangle"),
      h.AriaHidden(true),
      h.Style({
        height: `${box.height}px`,
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
      }),
    ]),
  ];
};
