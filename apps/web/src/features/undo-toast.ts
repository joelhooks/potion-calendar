import type { Html, HtmlBuilder } from "foldkit/html";

import type { DeleteIntentValue } from "../client/editing/delete-actor.js";
import { EditorAction } from "../client/editing/editor-action.js";

const deleteNoticeText = (intent: DeleteIntentValue): string => {
  if (
    intent.intent !== "noEmailOccurrence" &&
    intent.intent !== "emailOccurrence"
  ) {
    return `${intent.title} removed from this calendar.`;
  }

  const occurrence =
    intent.event.recurringEventId === undefined ? "" : "this occurrence of ";

  const hasOtherGuests =
    intent.event.organizer?.self === false ||
    (intent.event.attendees ?? []).some((person) => person.self !== true);

  const emailEnabled = intent.intent === "emailOccurrence" && hasOtherGuests;

  if (intent.event.organizer?.self === true) {
    const outcome = emailEnabled
      ? "Guests will be notified."
      : "No email sent.";

    return `Cancelled ${occurrence}"${intent.title}". ${outcome}`;
  }

  const outcome = emailEnabled
    ? "Google may email the organizer."
    : "No email sent.";

  return `Removed ${occurrence}"${intent.title}" from your calendar. ${outcome}`;
};

export const undoToast = <Message>(
  h: HtmlBuilder<Message>,
  props: {
    readonly intent: DeleteIntentValue;
    readonly send: (action: typeof EditorAction.Type) => Message;
    readonly stacked?: boolean;
  }
): Html =>
  h.keyed("aside")(
    `undo-${props.intent.id}`,
    [
      h.Class("undo-toast"),
      ...(props.stacked === true
        ? [h.Style({ "max-width": "100%", position: "static" })]
        : []),
      h.Role("status"),
      h.AriaLive("polite"),
      h.DataAttribute("undo-intent", props.intent.id),
    ],
    [
      h.span([], [deleteNoticeText(props.intent)]),
      h.button(
        [
          h.Type("button"),
          h.Title("Undo (Mod+Z)"),
          h.OnClick(
            props.send(EditorAction.cases.Undo.make({ id: props.intent.id }))
          ),
        ],
        ["Undo"]
      ),
      h.button(
        [
          h.Type("button"),
          h.AriaLabel("Dismiss Undo and delete now"),
          h.Title("Dismiss Undo and delete now"),
          h.OnClick(
            props.send(
              EditorAction.cases.DismissUndo.make({ id: props.intent.id })
            )
          ),
        ],
        ["×"]
      ),
    ]
  );
