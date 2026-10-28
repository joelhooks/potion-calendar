import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import {
  editorConferenceLink,
  editorMeetUnavailable,
  hasEditorConferencing,
} from "../client/editing/conferencing-draft.js";
import type { ConferencingEditor } from "../client/editing/conferencing-draft.js";
import { EditorAction } from "../client/editing/editor-action.js";
import { EditorView } from "../client/editing/editor-model.js";
import type { EditorProps } from "./editor-fields.js";

const conferencingSource = (editor: ConferencingEditor) =>
  editor.kind === "edit" ? Option.getOrUndefined(editor.original) : undefined;

const customProposalLabel = (
  editor: ConferencingEditor,
  id: string
): string => {
  const proposal = editor.draft.conferencing?.proposal;
  const entry = proposal?.id === id ? proposal : undefined;

  return entry === undefined
    ? "The saved custom link is unavailable. Saving will refuse rather than add another provider."
    : `${entry.name} · ${entry.link} will be appended to the description when you save. The current saved link will be checked again.`;
};

export const editorConferencingLabel = (editor: ConferencingEditor): string => {
  const request = editor.draft.conferencing?.request;

  if (request?.kind === "customLink") {
    return customProposalLabel(editor, request.id);
  }

  if (request?.kind === "googleMeet") {
    return "Google Meet will be created when you save.";
  }

  if (request?.kind === "none") {
    return "Conferencing will be removed when you save.";
  }

  const source = conferencingSource(editor);

  if (source?.conferencingStatus === "pending") {
    return "Google is creating the meeting link. It's not ready yet.";
  }

  if (source?.conferencingStatus === "failed") {
    return "Google couldn't create a Meet link.";
  }

  if (source?.conferencingStatus === "unconfirmed") {
    return "The meeting link couldn't be confirmed. Check the event before replacing it.";
  }

  if (source?.conferencingStatus === "ready") {
    return (
      editorConferenceLink(editor) ??
      "Conferencing is ready. No web Join link is available."
    );
  }

  return (
    editorConferenceLink(editor) ??
    (hasEditorConferencing(editor)
      ? "The meeting link couldn't be read. Replace or remove it explicitly."
      : "No conferencing requested")
  );
};

const conferencingActionLabel = (editor: ConferencingEditor): string => {
  if (
    editor.draft.conferencing?.request === undefined &&
    conferencingSource(editor)?.conferencingStatus === "failed"
  ) {
    return "Try again";
  }

  return hasEditorConferencing(editor)
    ? "Replace with Google Meet"
    : "Add Google Meet";
};

const conferencingDisplay = <Message>(
  h: HtmlBuilder<Message>,
  editor: ConferencingEditor
): Html => {
  const link = editorConferenceLink(editor);
  const status = conferencingSource(editor)?.conferencingStatus;

  if (link !== undefined && (status === undefined || status === "ready")) {
    const provider =
      new URL(link).hostname === "meet.google.com"
        ? "Google Meet"
        : "Meeting link";

    return h.p(
      [h.Class("editor-hint"), h.Style({ "overflow-wrap": "anywhere" })],
      [
        h.span([], [`${provider} · `]),
        h.a(
          [
            h.Href(link),
            h.Target("_blank"),
            h.Rel("noopener noreferrer"),
            h.Style({ color: "inherit" }),
          ],
          [link.replace(/^https?:\/\//u, "")]
        ),
      ]
    );
  }

  return h.p(
    [
      h.Role("status"),
      h.Class("editor-hint"),
      h.Style({ "overflow-wrap": "anywhere" }),
    ],
    [editorConferencingLabel(editor)]
  );
};

export const conferencingField = <Message>(
  h: HtmlBuilder<Message>,
  props: EditorProps<Message>
): Html => {
  const editor = { ...props.model, calendars: props.calendars };
  const request = editor.draft.conferencing?.request;
  const existing = hasEditorConferencing(editor);
  const reason = editorMeetUnavailable(editor, editor.permissions.editMeeting);
  const busy = EditorView.guards.Saving(editor);
  const buttonStyle = { padding: "4px 8px", width: "auto" };

  return h.section(
    [h.Class("editor-section"), h.AriaLabel("Conferencing")],
    [
      h.h3([], ["Conferencing"]),
      conferencingDisplay(h, editor),
      h.div(
        [
          h.Style({
            "align-items": "center",
            display: "flex",
            "flex-wrap": "wrap",
            gap: "8px",
          }),
        ],
        [
          h.button(
            [
              h.Type("button"),
              h.Id("event-add-meet"),
              h.Style(buttonStyle),
              h.Disabled(
                busy || reason !== undefined || request?.kind === "googleMeet"
              ),
              ...(reason === undefined
                ? []
                : [h.AriaDescribedBy("event-meet-availability")]),
              h.OnClick(props.send(EditorAction.cases.AddMeet.make({}))),
            ],
            [conferencingActionLabel(editor)]
          ),
          ...(existing ||
          request?.kind === "googleMeet" ||
          request?.kind === "customLink"
            ? [
                h.button(
                  [
                    h.Type("button"),
                    h.Id("event-remove-conferencing"),
                    h.AriaLabel("Remove conferencing"),
                    h.Style(buttonStyle),
                    h.Disabled(busy || !editor.permissions.editMeeting),
                    h.OnClick(
                      props.send(EditorAction.cases.RemoveConferencing.make({}))
                    ),
                  ],
                  ["Remove"]
                ),
              ]
            : []),
        ]
      ),
      ...(reason === undefined
        ? []
        : [
            h.p(
              [h.Id("event-meet-availability"), h.Class("editor-hint")],
              [reason]
            ),
          ]),
    ]
  );
};
