import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel } from "../client/app.js";
import {
  commandChoices,
  commandSections,
  selectedChoice,
} from "../client/keyboard/choices.js";
import { formatKey } from "../client/keyboard/hints.js";
import { bindingHints } from "../client/keyboard/registry.js";
import { Message } from "../client/message.js";
import type { AppMessage } from "../client/message.js";
import { zoneChooserHeading } from "../client/time-zones/choices.js";
import { ZoneChooser } from "../client/time-zones/model.js";

export const commandMenu = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  if (
    ![
      "commands",
      "days",
      "date",
      "zones",
      "event-zone",
      "event-type",
      "weekdays",
      "theme",
      "week-start",
      "colors",
    ].includes(model.keyboard.screen)
  ) {
    return [];
  }

  const choices = commandChoices(model);
  const selected = selectedChoice(model);

  const heading =
    model.keyboard.screen === "zones"
      ? zoneChooserHeading(model)
      : (new Map([
          ["event-zone", "Event time zone"],
          ["event-type", "Change event type"],
          ["weekdays", "Hide/unhide weekdays"],
          ["theme", "Theme"],
          ["week-start", "Start week on"],
          ["colors", "Change color"],
          ["date", "Go to date"],
          ["days", "Number of displayed days"],
        ]).get(model.keyboard.screen) ?? "Command menu");

  return [
    h.keyed("dialog")(
      "keyboard-command-dialog",
      [
        h.Id("keyboard-command-dialog"),
        h.DataAttribute("keyboard-dialog", "true"),
        h.DataAttribute(
          "keyboard-step",
          model.keyboard.screen === "zones"
            ? `zones:${model.timeZones.chooser._tag}`
            : model.keyboard.screen
        ),
        h.AriaLabel(heading),
        h.AriaModal(true),
        h.Style({
          "background-color": "var(--surface)",
          border: "1px solid var(--border)",
          "border-radius": "12px",
          "box-shadow": "0 20px 70px #0003",
          color: "var(--text)",
          "max-height": "75vh",
          padding: "0",
          width: "min(560px, 90vw)",
        }),
        h.OnKeyDownPreventDefault((key) => {
          if (key === "Escape") {
            return Option.some(Message.KeyboardClose());
          }

          if (key === "ArrowDown" || key === "ArrowUp") {
            return Option.some(
              Message.KeyboardMove({ direction: key === "ArrowDown" ? 1 : -1 })
            );
          }

          return key === "Enter"
            ? Option.some(Message.KeyboardReturn())
            : Option.none();
        }),
      ],
      [
        h.header(
          [
            h.Style({
              "align-items": "center",
              display: "flex",
              gap: "12px",
              padding: "12px",
            }),
          ],
          [
            h.label(
              [h.For("keyboard-query"), h.Style({ "font-size": "13px" })],
              [heading]
            ),
            ...(model.keyboard.screen === "event-zone"
              ? []
              : [
                  h.kbd(
                    [
                      h.DataAttribute("command-trigger-hint", "true"),
                      h.Style({ color: "var(--muted)", "font-size": "12px" }),
                    ],
                    bindingHints("commands")
                  ),
                ]),
            h.button(
              [
                h.Type("button"),
                h.OnClick(Message.KeyboardClose()),
                h.AriaLabel("Close command menu"),
                h.Style({ "margin-left": "auto" }),
              ],
              ["×"]
            ),
          ]
        ),
        h.input([
          h.Id("keyboard-query"),
          h.Role("combobox"),
          h.AriaLabel(heading),
          h.AriaExpanded(true),
          h.AriaControls("keyboard-choices"),
          h.AriaActiveDescendant(
            selected === undefined ? "" : `command-${selected.id}`
          ),
          h.Placeholder(
            new Map([
              ["event-zone", "Search city, region or time zone…"],
              ["weekdays", "Find a weekday…"],
              ["date", "e.g. nov 5, in 10 weeks"],
              [
                "zones",
                ZoneChooser.guards.RenameValue(model.timeZones.chooser)
                  ? "Custom label, or empty to restore default"
                  : "Search city, region or time zone…",
              ],
            ]).get(model.keyboard.screen) ?? "Type a command…"
          ),
          h.Value(model.keyboard.query),
          h.OnInput((query) => Message.KeyboardQuery({ query })),
          h.Style({
            border: "1px solid var(--border)",
            "border-radius": "6px",
            "box-sizing": "border-box",
            margin: "0 12px 12px",
            padding: "10px",
            width: "calc(100% - 24px)",
          }),
        ]),
        h.div(
          [
            h.Id("keyboard-choices"),
            h.Role("listbox"),
            h.AriaLabel("Commands"),
            h.Style({
              "max-height": "48vh",
              overflow: "auto",
              padding: "0 12px 12px",
            }),
          ],
          [
            ...commandSections.flatMap((section) => {
              const entries = choices.filter(
                (choice) => choice.section === section
              );

              return entries.length === 0
                ? []
                : [
                    h.keyed("section")(
                      section,
                      [h.AriaLabel(section)],
                      [
                        h.h2(
                          [
                            h.Style({
                              color: "var(--muted)",
                              "font-size": "11px",
                              margin: "12px 0 6px",
                              "text-transform": "uppercase",
                            }),
                          ],
                          [section]
                        ),
                        ...entries.map((choice) =>
                          h.keyed("button")(
                            choice.id,
                            [
                              h.Id(`command-${choice.id}`),
                              h.Type("button"),
                              h.Role("option"),
                              h.AriaSelected(choice.id === selected?.id),
                              h.AriaDisabled(choice.disabled),
                              h.Disabled(choice.disabled),
                              h.OnMouseEnter(
                                Message.KeyboardHighlight({ id: choice.id })
                              ),
                              h.OnClick(
                                Message.KeyboardPick({ id: choice.id })
                              ),
                              h.Tabindex(-1),
                              h.Style({
                                "background-color":
                                  choice.id === selected?.id
                                    ? "var(--pressed)"
                                    : "transparent",
                                border: "0",
                                "border-radius": "5px",
                                color: choice.disabled
                                  ? "var(--muted)"
                                  : "var(--text)",
                                display: "flex",
                                gap: "12px",
                                padding: "9px 8px",
                                "text-align": "left",
                                width: "100%",
                              }),
                            ],
                            [
                              h.span([], [choice.title]),
                              h.span(
                                [
                                  h.Style({
                                    color: "var(--muted)",
                                    "font-size": "11px",
                                    "margin-left": "auto",
                                    "white-space": "nowrap",
                                  }),
                                ],
                                [
                                  choice.keys
                                    .map((key) => formatKey(key))
                                    .join(" / "),
                                ]
                              ),
                            ]
                          )
                        ),
                      ]
                    ),
                  ];
            }),
            ...(choices.length === 0
              ? [
                  h.p(
                    [h.Role("status")],
                    [
                      model.keyboard.query.trim() === ""
                        ? "Enter a date"
                        : "No matching commands",
                    ]
                  ),
                ]
              : []),
          ]
        ),
        h.footer(
          [
            h.Style({
              "border-top": "1px solid var(--line)",
              color: "var(--muted)",
              display: "flex",
              "font-size": "12px",
              gap: "20px",
              padding: "12px",
            }),
          ],
          ["↑↓ Navigate · ↵ Select · Esc Close"]
        ),
      ]
    ),
  ];
};
