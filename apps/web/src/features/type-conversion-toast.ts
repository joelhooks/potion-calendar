import type { HtmlBuilder } from "foldkit/html";

import { createTypeLabels } from "../client/editing/create-type-choices.js";
import { EditorAction } from "../client/editing/editor-action.js";
import type { ConversionNotice } from "../client/editing/editor-model.js";

export const typeConversionToast = <Message>(
  h: HtmlBuilder<Message>,
  notice: typeof ConversionNotice.Type,
  send: (action: typeof EditorAction.Type) => Message
) =>
  h.aside(
    [
      h.Class("undo-toast"),
      h.Style({
        "align-self": "flex-end",
        "box-sizing": "border-box",
        "flex-shrink": "0",
        "max-width": "100%",
        position: "static",
      }),
      h.Role("status"),
      h.AriaLive("polite"),
      h.DataAttribute("conversion-undo", notice.id),
    ],
    [
      h.span([], [`Converted to ${createTypeLabels[notice.target]}`]),
      h.button(
        [
          h.Type("button"),
          h.Title("Undo (Mod+Z)"),
          h.OnClick(
            send(EditorAction.cases.UndoConversion.make({ id: notice.id }))
          ),
        ],
        ["Undo"]
      ),
    ]
  );
