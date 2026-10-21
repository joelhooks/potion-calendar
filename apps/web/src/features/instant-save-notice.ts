import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";
import { EditorAction } from "../client/editing/editor-action.js";
import type { InstantSaveNotice } from "../client/editing/ui-model.js";

const noticeText = (notice: typeof InstantSaveNotice.Type): string => {
  if (notice.movement === "occurrence") {
    return `Moved this occurrence of "${notice.title}". No email sent.`;
  }

  if (notice.movement === "event") {
    return `Moved "${notice.title}". No email sent.`;
  }

  return `Saved "${notice.title}". No email sent.`;
};

export const instantSaveNotice = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] =>
  Option.toArray(model.editing.instantSaved).map((notice) =>
    h.keyed("section")(
      notice.id,
      [h.Class("instant-save-notice calendar-read-notice"), h.Role("status")],
      [
        h.p([], [noticeText(notice)]),
        h.button(
          [
            h.AriaLabel(
              notice.movement === undefined
                ? "Dismiss saved notice"
                : "Dismiss moved notice"
            ),
            h.OnClick(
              Message.EditingAction({
                action: EditorAction.cases.DismissInstantSave.make({
                  id: notice.id,
                }),
                personId: Option.getOrUndefined(model.person),
              })
            ),
          ],
          ["×"]
        ),
      ]
    )
  );
