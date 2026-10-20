import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel } from "../client/app.js";
import { shortcutMatches } from "../client/keyboard/choices.js";
import { keyboardRegistry, keyHints } from "../client/keyboard/registry.js";
import type { ShortcutSection } from "../client/keyboard/registry.js";
import { Message } from "../client/message.js";
import type { AppMessage } from "../client/message.js";

export const shortcutSections: readonly ShortcutSection[] = [
  "General",
  "Workflows",
  "Editing",
  "Calendar view",
  "Calendar navigation",
  "App navigation",
];

export const shortcutsPage = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): Html =>
  h.section(
    [
      h.Id("shortcuts-page"),
      h.AriaLabel("Keyboard shortcuts"),
      h.Style({
        height: "calc(100vh - 100px)",
        margin: "auto",
        "max-width": "900px",
        overflow: "auto",
        padding: "24px",
      }),
      h.OnKeyDownPreventDefault((key) => {
        if (key === "Escape") {
          return Option.some(Message.KeyboardClose());
        }

        return key === "/" || key === "?"
          ? Option.some(Message.KeyboardAction({ id: "focus-shortcuts" }))
          : Option.none();
      }),
    ],
    [
      h.header(
        [h.Style({ "align-items": "center", display: "flex", gap: "20px" })],
        [
          h.h1([], ["Keyboard shortcuts"]),
          h.button([h.OnClick(Message.KeyboardClose())], ["Back"]),
        ]
      ),
      h.input([
        h.Id("shortcuts-query"),
        h.Type("search"),
        h.AriaLabel("Search keyboard shortcuts"),
        h.Placeholder("Search keyboard shortcuts"),
        h.Value(model.keyboard.query),
        h.OnInput((query) => Message.KeyboardQuery({ query })),
        h.Style({ "box-sizing": "border-box", padding: "10px", width: "100%" }),
      ]),
      ...shortcutSections.flatMap((section) => {
        const actions = keyboardRegistry.filter(
          (action) =>
            action.section === section &&
            action.keys.length > 0 &&
            shortcutMatches(action, model.keyboard.query)
        );

        return actions.length === 0
          ? []
          : [
              h.keyed("section")(
                section,
                [h.Id(section.toLowerCase().replaceAll(" ", "-"))],
                [
                  h.h2(
                    [h.Style({ "font-size": "16px", "margin-top": "24px" })],
                    [section]
                  ),
                  ...actions.map((action) =>
                    h.keyed("div")(
                      action.id,
                      [
                        h.DataAttribute("shortcut-id", action.id),
                        h.Style({
                          "border-bottom": "1px solid var(--line)",
                          display: "flex",
                          gap: "20px",
                          "justify-content": "space-between",
                          padding: "10px 0",
                        }),
                      ],
                      [
                        h.span([], [action.title]),
                        h.kbd(
                          [
                            h.Style({
                              "font-size": "12px",
                              "white-space": "nowrap",
                            }),
                          ],
                          [keyHints(action).join(" / ")]
                        ),
                      ]
                    )
                  ),
                ]
              ),
            ];
      }),
    ]
  );
