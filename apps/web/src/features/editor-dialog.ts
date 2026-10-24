import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import { EditorAction } from "../client/editing/editor-action.js";

export interface EditorDialogProps<Message> {
  readonly body: readonly (Html | string)[];
  readonly cancelDisabled?: boolean;
  readonly compact?: boolean;
  readonly confirm: typeof EditorAction.Type;
  readonly confirmDisabled?: boolean;
  readonly confirmLabel: string;
  readonly dismissOnly?: boolean;
  readonly extra?: Html | undefined;
  readonly footerNotice?: Html | undefined;
  readonly id: string;
  readonly initialFocus: string;
  readonly label: string;
  readonly send: (action: typeof EditorAction.Type) => Message;
}

export const editorDialog = <Message>(
  h: HtmlBuilder<Message>,
  props: EditorDialogProps<Message>
): Html =>
  h.keyed("dialog")(
    props.id,
    [
      h.Id(props.id),
      h.Class(
        props.dismissOnly === true
          ? "editor-dialog editor-recovery"
          : "editor-dialog"
      ),
      h.AriaModal(true),
      h.AriaLabel(props.label),
      h.DataAttribute("editing-dialog", "true"),
      h.DataAttribute("initial-focus", props.initialFocus),
      h.OnKeyDownPreventDefault((key, modifiers) => {
        if (key === "Escape") {
          return Option.some(props.send(EditorAction.cases.Cancel.make({})));
        }

        if (
          key === "Enter" &&
          !modifiers.shiftKey &&
          (modifiers.ctrlKey || modifiers.metaKey)
        ) {
          return Option.some(props.send(props.confirm));
        }

        return Option.none();
      }),
    ],
    [
      h.form(
        [h.OnSubmit(props.send(props.confirm))],
        [
          h.header(
            [h.Class("editor-heading")],
            [
              h.h2([], [props.label]),
              h.button(
                [
                  h.Type("button"),
                  h.Class("editor-close"),
                  h.AriaLabel("Close dialog"),
                  h.Disabled(props.cancelDisabled ?? false),
                  h.OnClick(props.send(EditorAction.cases.Cancel.make({}))),
                ],
                ["×"]
              ),
            ]
          ),
          h.div(
            [
              h.Class("editor-scroll"),
              ...(props.compact === true
                ? [h.Style({ "padding-bottom": "0" })]
                : []),
            ],
            props.body
          ),
          ...(props.footerNotice === undefined ? [] : [props.footerNotice]),
          h.footer(
            [h.Class("editor-footer")],
            [
              ...(props.dismissOnly === true
                ? []
                : [
                    h.button(
                      [
                        h.Type("button"),
                        h.Disabled(props.cancelDisabled ?? false),
                        h.OnClick(
                          props.send(EditorAction.cases.Cancel.make({}))
                        ),
                      ],
                      ["Cancel"]
                    ),
                  ]),
              h.button(
                [
                  h.Type("submit"),
                  h.Id(`${props.id}-confirm`),
                  h.Class("editor-primary"),
                  h.Disabled(props.confirmDisabled ?? false),
                ],
                [props.confirmLabel]
              ),
            ]
          ),
        ]
      ),
      ...(props.extra === undefined ? [] : [props.extra]),
    ]
  );
