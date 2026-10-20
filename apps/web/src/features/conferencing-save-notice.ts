import { Match } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { ConferencingSaveNotice } from "../client/conferencing/model.js";
import { EditorAction } from "../client/editing/editor-action.js";

export const conferencingNoticeText = (
  status: (typeof ConferencingSaveNotice.Type)["status"]
): string =>
  Match.value(status).pipe(
    Match.when("ready", () => "Conferencing is ready."),
    Match.when("removed", () => "Conferencing was removed."),
    Match.when(
      "pending",
      () =>
        "Google is still creating the conferencing. No Join link is available yet."
    ),
    Match.when(
      "failed",
      () =>
        "The event was saved, but Google could not create its conferencing. Check the event before requesting another link."
    ),
    Match.when(
      "unconfirmed",
      () =>
        "The event was saved, but conferencing could not be confirmed. Refresh or check it in Google Calendar before requesting another link."
    ),
    Match.exhaustive
  );

export const conferencingSaveNotice = <Message>(
  h: HtmlBuilder<Message>,
  notice: typeof ConferencingSaveNotice.Type,
  send: (action: typeof EditorAction.Type) => Message
): Html =>
  h.section(
    [
      h.Role(
        notice.status === "failed" || notice.status === "unconfirmed"
          ? "alert"
          : "status"
      ),
      h.AriaLabel("Saved event conferencing"),
      h.Class("editor-section"),
      h.Style({
        background: "var(--surface)",
        border: "1px solid var(--border)",
        "border-radius": "8px",
        "box-shadow": "0 6px 24px #182b2033",
        margin: "0",
        "max-width": "min(420px, calc(100vw - 48px))",
        padding: "16px",
      }),
    ],
    [
      h.h3([], ["Event saved"]),
      h.p([], [notice.title]),
      h.p([], [conferencingNoticeText(notice.status)]),
      h.button(
        [
          h.Type("button"),
          h.OnClick(
            send(
              EditorAction.cases.DismissConferencingNotice.make({
                id: notice.id,
              })
            )
          ),
        ],
        ["Dismiss"]
      ),
    ]
  );
