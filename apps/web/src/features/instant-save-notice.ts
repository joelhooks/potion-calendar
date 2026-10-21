import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";
import { EditorAction } from "../client/editing/editor-action.js";

export const instantSaveNotice = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] =>
  Option.toArray(model.editing.instantSaved).map((notice) =>
    h.keyed("section")(
      notice.id,
      [h.Class("instant-save-notice calendar-read-notice"), h.Role("status")],
      [
        h.p([], [`Saved "${notice.title}". No email sent.`]),
        h.button(
          [
            h.AriaLabel("Dismiss saved notice"),
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
