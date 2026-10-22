import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";
import {
  TimeBlockAction,
  blockRangeIssue,
} from "../client/time-blocks/model.js";
import { blockClock } from "../layout/time-blocks.js";

type Action = typeof TimeBlockAction.Type;

const blockEditor = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>,
  send: (action: Action) => AppMessage
): Html => {
  const { draft, error } = model.settings.timeBlockEditor.context;

  const editing = model.settings.timeBlocks.blocks.some(
    (block) => block.id === draft.id
  );

  const textField = (
    id: string,
    label: string,
    value: string,
    make: (value: string) => Action,
    issue: Option.Option<string> = Option.none()
  ) =>
    h.label(
      [h.For(id), h.Class("time-block-field")],
      [
        h.span([], [label]),
        h.input([
          h.Id(id),
          h.Type("text"),
          h.Value(value),
          ...Option.match(issue, {
            onNone: () => [],
            onSome: () => [
              h.AriaInvalid(true),
              h.AriaDescribedBy(`${id}-error`),
            ],
          }),
          h.OnInput((text) => send(make(text))),
        ]),
        ...Option.match(issue, {
          onNone: () => [],
          onSome: (message) => [
            h.p([h.Id(`${id}-error`), h.Role("alert")], [message]),
          ],
        }),
      ]
    );

  const rangeError = (index: number, edge: "start" | "end") =>
    Option.isNone(error)
      ? Option.none<string>()
      : Option.fromNullishOr(draft.ranges[index]).pipe(
          Option.flatMap(blockRangeIssue),
          Option.filter((issue) => issue.edge === edge),
          Option.map((issue) => issue.message)
        );

  return h.form(
    [
      h.Class("time-block-editor"),
      h.AriaLabel(editing ? "Edit time block" : "Add time block"),
      h.OnSubmit(send(TimeBlockAction.cases.Save.make({}))),
    ],
    [
      h.h3([], [editing ? "Edit time block" : "Add time block"]),
      textField("time-block-name", "Name", draft.name, (value) =>
        TimeBlockAction.cases.Name.make({ value })
      ),
      h.label(
        [h.For("time-block-color"), h.Class("time-block-field")],
        [
          h.span([], ["Color"]),
          h.input([
            h.Id("time-block-color"),
            h.Type("color"),
            h.Value(draft.color),
            h.OnInput((value) =>
              send(TimeBlockAction.cases.Color.make({ value }))
            ),
          ]),
        ]
      ),
      h.label(
        [h.Class("time-block-check")],
        [
          h.input([
            h.Type("checkbox"),
            h.Checked(draft.hidden),
            h.AriaLabel("Hide these ranges in the grid"),
            h.OnClick(
              send(TimeBlockAction.cases.Hidden.make({ value: !draft.hidden }))
            ),
          ]),
          "Hide these ranges in the grid",
        ]
      ),
      h.p(
        [h.Class("muted")],
        [
          "Use 24-hour HH:MM. An end may be 24:00. Enter an overnight block as two ranges.",
        ]
      ),
      ...draft.ranges.map((range, index) =>
        h.fieldset(
          [h.Class("time-block-range")],
          [
            h.legend([], [`Range ${index + 1}`]),
            textField(
              `time-block-start-${index}`,
              `Start ${index + 1}`,
              range.start,
              (value) =>
                TimeBlockAction.cases.Range.make({
                  edge: "start",
                  index,
                  value,
                }),
              rangeError(index, "start")
            ),
            textField(
              `time-block-end-${index}`,
              `End ${index + 1}`,
              range.end,
              (value) =>
                TimeBlockAction.cases.Range.make({ edge: "end", index, value }),
              rangeError(index, "end")
            ),
            h.button(
              [
                h.Type("button"),
                h.Disabled(draft.ranges.length === 1),
                h.OnClick(
                  send(TimeBlockAction.cases.RemoveRange.make({ index }))
                ),
                h.AriaLabel(`Remove range ${index + 1}`),
              ],
              ["Remove range"]
            ),
          ]
        )
      ),
      h.button(
        [
          h.Type("button"),
          h.OnClick(send(TimeBlockAction.cases.AddRange.make({}))),
        ],
        ["Add range"]
      ),
      ...Option.match(error, {
        onNone: () => [],
        onSome: (message) =>
          draft.name.trim() === "" ||
          draft.ranges.length === 0 ||
          draft.ranges.every((range) => Option.isNone(blockRangeIssue(range)))
            ? [h.p([h.Role("alert")], [message])]
            : [],
      }),
      h.div(
        [h.Class("time-block-actions")],
        [
          h.button([h.Type("submit")], ["Save time block"]),
          h.button(
            [
              h.Type("button"),
              h.OnClick(send(TimeBlockAction.cases.Cancel.make({}))),
            ],
            ["Cancel"]
          ),
        ]
      ),
    ]
  );
};

export const settingsTimeBlocks = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): Html => {
  const preferences = model.settings.timeBlocks;
  const personId = Option.getOrElse(model.person, () => "");

  const send = (action: Action) =>
    Message.ChangedTimeBlocks({ action, personId });

  const editing = model.settings.timeBlockEditor.value === "editing";

  return h.section(
    [
      h.Class("settings-section time-block-settings"),
      h.AriaLabel("Time blocks"),
    ],
    [
      h.h2([], ["Time blocks"]),
      h.label(
        [h.Class("time-block-check")],
        [
          h.input([
            h.Id("time-blocks-enabled"),
            h.Type("checkbox"),
            h.Checked(preferences.enabled),
            h.OnClick(
              send(
                TimeBlockAction.cases.Enable.make({
                  value: !preferences.enabled,
                })
              )
            ),
          ]),
          "Show time blocks",
        ]
      ),
      h.p(
        [h.Class("muted")],
        [
          "Each block repeats every day. Hidden blocks shrink to a thin strip; your events keep their times.",
        ]
      ),
      ...(editing
        ? [blockEditor(model, h, send)]
        : [
            ...(preferences.blocks.length === 0
              ? [
                  h.p(
                    [h.Class("time-block-empty")],
                    [
                      "No time blocks yet. Add one to color or hide part of your day.",
                    ]
                  ),
                ]
              : []),
            ...preferences.blocks.map((block) =>
              h.keyed("div")(
                String(block.id),
                [
                  h.Class("time-block-item"),
                  h.DataAttribute("time-block-id", String(block.id)),
                ],
                [
                  h.span([
                    h.Class("time-block-swatch"),
                    h.Style({ background: block.color }),
                    h.AriaHidden(true),
                  ]),
                  h.div(
                    [],
                    [
                      h.strong([], [block.name]),
                      h.p(
                        [h.Class("muted")],
                        [
                          `${block.hidden ? "Hidden" : "Colored"} · ${block.ranges.map((range) => `${blockClock(range.startMinute)}–${blockClock(range.endMinute)}`).join(", ")}`,
                        ]
                      ),
                    ]
                  ),
                  h.button(
                    [
                      h.Type("button"),
                      h.AriaLabel(`Edit ${block.name}`),
                      h.OnClick(
                        send(TimeBlockAction.cases.Edit.make({ id: block.id }))
                      ),
                    ],
                    ["Edit"]
                  ),
                  h.button(
                    [
                      h.Type("button"),
                      h.AriaLabel(`Remove ${block.name}`),
                      h.OnClick(
                        send(
                          TimeBlockAction.cases.Remove.make({ id: block.id })
                        )
                      ),
                    ],
                    ["Remove"]
                  ),
                ]
              )
            ),
            h.button(
              [
                h.Type("button"),
                h.OnClick(send(TimeBlockAction.cases.Add.make({}))),
              ],
              ["Add time block"]
            ),
          ]),
    ]
  );
};
