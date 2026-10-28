import type { Html, HtmlBuilder } from "foldkit/html";

import { EditorAction } from "../client/editing/editor-action.js";
import type { RepeatTextField } from "../client/editing/editor-action.js";
import { EditorView } from "../client/editing/editor-model.js";
import type { Weekday } from "../client/editing/editor-model.js";
import { localizedWeekday } from "../layout/app-locale.js";
import { editorDialog } from "./editor-dialog.js";
import { editorInput } from "./editor-fields.js";
import type { EditorProps } from "./editor-fields.js";

type RepeatDialogProps<Message> = Omit<EditorProps<Message>, "model"> & {
  readonly model: typeof EditorView.cases.CustomRepeat.Type;
};

const weekdays: readonly (typeof Weekday.Type)[] = [
  "SU",
  "MO",
  "TU",
  "WE",
  "TH",
  "FR",
  "SA",
];

const weekdayLabels: Readonly<Record<typeof Weekday.Type, string>> = {
  FR: "Friday",
  MO: "Monday",
  SA: "Saturday",
  SU: "Sunday",
  TH: "Thursday",
  TU: "Tuesday",
  WE: "Wednesday",
};

const weekdayLabel = (
  weekday: typeof Weekday.Type,
  locale = "en-US"
): string =>
  locale === "en-US"
    ? weekdayLabels[weekday]
    : localizedWeekday(weekdays.indexOf(weekday), locale);

export const repeatField = <Message>(
  h: HtmlBuilder<Message>,
  props: EditorProps<Message>
): Html =>
  h.section(
    [h.Class("editor-section")],
    [
      h.label(
        [h.Class("editor-field"), h.For("event-repeat")],
        [
          h.span([], ["Repeat"]),
          h.select(
            [
              h.Id("event-repeat"),
              h.Value(props.model.draft.repeat.preset),
              h.Disabled(
                EditorView.guards.Saving(props.model) ||
                  !props.model.permissions.editMeeting
              ),
              h.OnChange((value) =>
                props.send(
                  EditorAction.cases.RepeatPresetSelected.make({ value })
                )
              ),
            ],
            [
              ...(props.model.draft.repeat.rules.length > 0
                ? [
                    h.option(
                      [
                        h.Value("unchanged"),
                        h.Selected(
                          props.model.draft.repeat.preset === "unchanged"
                        ),
                      ],
                      ["Current repeat pattern"]
                    ),
                  ]
                : []),
              ...[
                { label: "Does not repeat", value: "none" },
                { label: "Every day", value: "daily" },
                { label: "Every weekday", value: "weekdays" },
                { label: "Every week", value: "weekly" },
                { label: "Every month", value: "monthly" },
                { label: "Every year", value: "yearly" },
                { label: "Custom…", value: "custom" },
              ].map((choice) =>
                h.option(
                  [
                    h.Value(choice.value),
                    h.Selected(
                      props.model.draft.repeat.preset === choice.value
                    ),
                  ],
                  [choice.label]
                )
              ),
            ]
          ),
        ]
      ),
      ...(props.model.draft.repeat.rules.length > 0
        ? [
            h.details(
              [],
              [
                h.summary([], ["Current repeat rule"]),
                h.code(
                  [h.Class("editor-rule")],
                  [props.model.draft.repeat.rules.join("\n")]
                ),
              ]
            ),
          ]
        : []),
    ]
  );

const repeatInput = <Message>(
  h: HtmlBuilder<Message>,
  props: RepeatDialogProps<Message>,
  field: typeof RepeatTextField.Type,
  label: string,
  type = "text"
): Html =>
  editorInput(h, {
    disabled: false,
    id: `repeat-${field}`,
    label,
    onInput: (value) =>
      props.send(EditorAction.cases.RepeatFieldEdited.make({ field, value })),
    required: true,
    type,
    value: props.model.custom[field],
  });

const repeatSelect = <Message>(
  h: HtmlBuilder<Message>,
  props: RepeatDialogProps<Message>,
  field: typeof RepeatTextField.Type,
  label: string,
  choices: readonly { readonly label: string; readonly value: string }[]
): Html =>
  h.label(
    [h.Class("editor-field"), h.For(`repeat-${field}`)],
    [
      h.span([], [label]),
      h.select(
        [
          h.Id(`repeat-${field}`),
          h.Value(props.model.custom[field]),
          h.OnChange((value) =>
            props.send(
              EditorAction.cases.RepeatFieldEdited.make({ field, value })
            )
          ),
        ],
        choices.map((choice) =>
          h.option(
            [
              h.Value(choice.value),
              h.Selected(props.model.custom[field] === choice.value),
            ],
            [choice.label]
          )
        )
      ),
    ]
  );

const weeklyFields = <Message>(
  h: HtmlBuilder<Message>,
  props: RepeatDialogProps<Message>
): Html =>
  h.fieldset(
    [h.Class("editor-section")],
    [
      h.legend([], ["Days of the week"]),
      h.div(
        [h.Class("editor-weekdays")],
        weekdays.map((weekday) =>
          h.label(
            [h.Class("editor-check")],
            [
              h.input([
                h.Type("checkbox"),
                h.Checked(props.model.custom.weekdays.includes(weekday)),
                h.OnClick(
                  props.send(
                    EditorAction.cases.RepeatWeekdayToggled.make({ weekday })
                  )
                ),
              ]),
              weekdayLabel(weekday, props.locale),
            ]
          )
        )
      ),
    ]
  );

const monthlyFields = <Message>(
  h: HtmlBuilder<Message>,
  props: RepeatDialogProps<Message>
): readonly Html[] => [
  repeatSelect(h, props, "monthPattern", "Monthly pattern", [
    { label: "Day of the month", value: "date" },
    { label: "Weekday position", value: "weekday" },
  ]),
  ...(props.model.custom.monthPattern === "weekday"
    ? [
        h.div(
          [h.Class("editor-row")],
          [
            repeatSelect(h, props, "ordinal", "Position", [
              { label: "First", value: "1" },
              { label: "Second", value: "2" },
              { label: "Third", value: "3" },
              { label: "Fourth", value: "4" },
              { label: "Fifth", value: "5" },
              { label: "Last", value: "-1" },
            ]),
            repeatSelect(
              h,
              props,
              "weekday",
              "Weekday",
              weekdays.map((weekday) => ({
                label: weekdayLabel(weekday, props.locale),
                value: weekday,
              }))
            ),
          ]
        ),
      ]
    : [
        h.p(
          [h.Class("editor-hint")],
          ["Uses the event's start day of the month."]
        ),
      ]),
];

export const customRepeatDialog = <Message>(
  h: HtmlBuilder<Message>,
  props: RepeatDialogProps<Message>
): Html => {
  const { custom } = props.model;

  return editorDialog(h, {
    body: [
      h.div(
        [h.Class("editor-row")],
        [
          repeatInput(h, props, "interval", "Repeat every", "number"),
          repeatSelect(h, props, "frequency", "Unit", [
            { label: "Days", value: "DAILY" },
            { label: "Weeks", value: "WEEKLY" },
            { label: "Months", value: "MONTHLY" },
            { label: "Years", value: "YEARLY" },
          ]),
        ]
      ),
      ...(custom.frequency === "WEEKLY" ? [weeklyFields(h, props)] : []),
      ...(custom.frequency === "MONTHLY" || custom.frequency === "YEARLY"
        ? monthlyFields(h, props)
        : []),
      repeatSelect(h, props, "end", "Ends", [
        { label: "Never", value: "never" },
        { label: "On a date", value: "on" },
        { label: "After N occurrences", value: "after" },
      ]),
      ...(custom.end === "on"
        ? [repeatInput(h, props, "until", "Last date", "date")]
        : []),
      ...(custom.end === "after"
        ? [repeatInput(h, props, "count", "Occurrences", "number")]
        : []),
      ...(custom.rules.length > 0
        ? [
            h.p(
              [h.Class("editor-hint")],
              ["These settings replace the current repeat rule."]
            ),
          ]
        : []),
    ],
    confirm: EditorAction.cases.RepeatAccepted.make({}),
    confirmLabel: "Use this repeat pattern",
    extra: props.toast,
    id: "custom-repeat-dialog",
    initialFocus: "repeat-interval",
    label: "Custom repeat",
    send: props.send,
  });
};
