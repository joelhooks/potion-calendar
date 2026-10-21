import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import { clipboardGuestCount } from "../client/clipboard/guest-count.js";
import { ClipboardView } from "../client/clipboard/model.js";
import { ClipboardAction } from "../client/clipboard/runtime.js";

export const clipboardPanel = <Message>(
  h: HtmlBuilder<Message>,
  view: typeof ClipboardView.Type,
  send: (action: typeof ClipboardAction.Type) => Message,
  stacked?: boolean
): Html => {
  const placement =
    stacked === true
      ? [h.Style({ "max-width": "100%", position: "static" })]
      : [];

  if (ClipboardView.guards.Results(view)) {
    return h.section(
      [
        h.Class("bulk-notice clipboard-results"),
        h.Role("status"),
        h.AriaLabel("Paste results"),
        ...placement,
      ],
      [
        h.h3(
          [],
          [
            `Pasted ${view.succeeded} ${view.succeeded === 1 ? "event" : "events"}`,
          ]
        ),
        ...(view.issues.length === 0
          ? []
          : [
              h.h4(
                [],
                [
                  `Couldn't paste ${view.issues.length} ${view.issues.length === 1 ? "event" : "events"}`,
                ]
              ),
              h.ul(
                [],
                view.issues.map((issue) =>
                  h.li(
                    [],
                    [issue.sentence ?? `${issue.title}: ${issue.reason}`]
                  )
                )
              ),
            ]),
        ...(view.succeeded > 0
          ? [h.p([], ["Copies can't be undone; delete them if needed."])]
          : []),
        h.button(
          [
            h.Type("button"),
            h.OnClick(
              send(ClipboardAction.cases.DismissToast.make({ id: view.id }))
            ),
          ],
          ["Dismiss"]
        ),
      ]
    );
  }

  if (ClipboardView.guards.Guests(view)) {
    const group = (view.itemCount ?? 1) > 1;
    const label = group ? `Paste ${view.itemCount} events` : "Paste event";

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
        h.Class("editor-dialog clipboard-dialog"),
        h.AriaModal(true),
        h.AriaLabel(label),
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
            h.header([h.Class("editor-heading")], [h.h2([], [label])]),
            h.div(
              [h.Class("editor-scroll")],
              [
                h.p(
                  [],
                  [
                    group
                      ? `Paste ${view.itemCount} events into ${view.calendarTitle}. One guest choice applies to the whole group.`
                      : `Paste “${view.title}” into ${view.calendarTitle}.`,
                  ]
                ),
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
      [h.Class("undo-toast clipboard-toast"), h.Role("alert"), ...placement],
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
        ...placement,
        h.Role("status"),
        h.AriaLive("polite"),
      ],
      [(view.itemCount ?? 1) > 1 ? "Pasting events…" : "Pasting event…"]
    );
  }

  return Option.match(view.toast, {
    onNone: () => h.span([]),
    onSome: (toast) =>
      h.aside(
        [
          h.Class("undo-toast clipboard-toast"),
          ...placement,
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
