import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import { clipboardGuestCount } from "../client/clipboard/guest-count.js";
import { ClipboardView } from "../client/clipboard/model.js";
import { ClipboardAction } from "../client/clipboard/runtime.js";

export const clipboardPanel = <Message>(
  h: HtmlBuilder<Message>,
  view: typeof ClipboardView.Type,
  send: (action: typeof ClipboardAction.Type) => Message
): Html => {
  if (ClipboardView.guards.Guests(view)) {
    const exclude = send(
      ClipboardAction.cases.Guests.make({
        choice: "exclude",
        intentId: view.intentId,
      })
    );

    const cancel = send(
      ClipboardAction.cases.Cancel.make({ intentId: view.intentId })
    );

    return h.keyed("dialog")(
      `clipboard-${view.intentId}`,
      [
        h.Id("clipboard-guests"),
        h.Class("editor-dialog"),
        h.AriaModal(true),
        h.AriaLabel("Paste event"),
        h.DataAttribute("clipboard-dialog", view.intentId),
        h.DataAttribute("initial-focus", "clipboard-exclude"),
        h.OnKeyDownPreventDefault((key) =>
          key === "Escape" ? Option.some(cancel) : Option.none()
        ),
      ],
      [
        h.form(
          [h.OnSubmit(exclude)],
          [
            h.header([h.Class("editor-heading")], [h.h2([], ["Paste event"])]),
            h.div(
              [h.Class("editor-scroll")],
              [
                h.p([], [`Paste “${view.title}” into ${view.calendarTitle}.`]),
                h.p(
                  [],
                  [
                    view.complete
                      ? `Include ${clipboardGuestCount(view.count)}? They'll get an invitation email.`
                      : "The source guest list is incomplete. Paste without guests to avoid inviting only part of the list.",
                  ]
                ),
              ]
            ),
            h.footer(
              [h.Class("editor-footer")],
              [
                h.button([h.Type("button"), h.OnClick(cancel)], ["Cancel"]),
                h.button(
                  [
                    h.Type("submit"),
                    h.Id("clipboard-exclude"),
                    h.Class("editor-primary"),
                  ],
                  ["Paste without guests"]
                ),
                h.button(
                  [
                    h.Type("button"),
                    h.Disabled(!view.complete),
                    h.OnClick(
                      send(
                        ClipboardAction.cases.Guests.make({
                          choice: "includeAndEmail",
                          intentId: view.intentId,
                        })
                      )
                    ),
                  ],
                  ["Invite guests (sends email)"]
                ),
              ]
            ),
          ]
        ),
      ]
    );
  }

  if (ClipboardView.guards.Failure(view)) {
    return h.aside(
      [h.Class("undo-toast clipboard-toast"), h.Role("alert")],
      [
        h.span([], [view.message]),
        ...(view.retryable
          ? [
              h.button(
                [
                  h.Type("button"),
                  h.OnClick(
                    send(
                      ClipboardAction.cases.Retry.make({
                        intentId: view.intentId,
                      })
                    )
                  ),
                ],
                ["Retry"]
              ),
            ]
          : []),
        h.button(
          [
            h.Type("button"),
            h.OnClick(
              send(
                ClipboardAction.cases.Abandon.make({ intentId: view.intentId })
              )
            ),
          ],
          ["Close"]
        ),
      ]
    );
  }

  if (
    ClipboardView.guards.Preparing(view) ||
    ClipboardView.guards.Creating(view)
  ) {
    return h.aside(
      [
        h.Class("undo-toast clipboard-toast"),
        h.Role("status"),
        h.AriaLive("polite"),
      ],
      ["Pasting event…"]
    );
  }

  return Option.match(view.toast, {
    onNone: () => h.span([]),
    onSome: (toast) =>
      h.aside(
        [
          h.Class("undo-toast clipboard-toast"),
          h.Role("status"),
          h.AriaLive("polite"),
        ],
        [
          h.span([], [toast.message]),
          h.button(
            [
              h.Type("button"),
              h.AriaLabel("Dismiss clipboard message"),
              h.OnClick(
                send(ClipboardAction.cases.DismissToast.make({ id: toast.id }))
              ),
            ],
            ["×"]
          ),
        ]
      ),
  });
};
