import { statusEventType } from "@calendar/calendar/contracts";
import type { CalendarValue } from "@calendar/calendar/contracts";
import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import { calendarKey } from "../client/calendar-state.js";
import { EditorAction } from "../client/editing/editor-action.js";
import type { EditorTextField } from "../client/editing/editor-action.js";
import { EditorView } from "../client/editing/editor-model.js";
import type { EditorViewValue } from "../client/editing/editor-model.js";
import { eventPalette } from "../layout/colors.js";
import { eventZoneLabel } from "../layout/event-zone-preview.js";
import type { LocationMaps } from "../layout/location-maps.js";
import { chipColors } from "../layout/settings-colors.js";
import {
  canonicalClockInput,
  clockInputLabel,
} from "../layout/settings-time-input.js";
import type { ResolvedTimeFormat } from "../layout/time-format.js";
import { editorZoneExplanation } from "./editor-zone-explanation.js";

export type OpenEditorView = Exclude<
  EditorViewValue,
  typeof EditorView.cases.Closed.Type | typeof EditorView.cases.Loading.Type
>;

export interface EditorProps<Message> {
  readonly initialFocus?: string;
  readonly locationMaps?: typeof LocationMaps.Type;
  readonly primaryZone?: string;
  readonly chooseTimeZone?: Message;
  readonly calendars: readonly CalendarValue[];
  readonly model: OpenEditorView;
  readonly reminderLimit: number;
  readonly timeFormat?: ResolvedTimeFormat;
  readonly theme?: "light" | "dark";
  readonly toast?: Html | undefined;
  readonly send: (action: typeof EditorAction.Type) => Message;
}

export interface InputProps<Message> {
  readonly disabled: boolean;
  readonly id: string;
  readonly label: string;
  readonly onInput: (value: string) => Message;
  readonly placeholder?: string | undefined;
  readonly required?: boolean;
  readonly type?: string;
  readonly value: string;
}

export const editorInput = <Message>(
  h: HtmlBuilder<Message>,
  props: InputProps<Message>
): Html =>
  h.label(
    [h.Class("editor-field"), h.For(props.id)],
    [
      h.span([], [props.label]),
      h.input([
        h.Id(props.id),
        h.Name(props.id),
        h.Type(props.type ?? "text"),
        h.Value(props.value),
        ...(props.placeholder === undefined
          ? []
          : [h.Placeholder(props.placeholder)]),
        h.Disabled(props.disabled),
        h.Required(props.required ?? false),
        h.OnInput(props.onInput),
      ]),
    ]
  );

const textPlaceholders = new Map([
  ["title", "Title"],
  ["location", "Location"],
]);

const draftInput = <Message>(
  h: HtmlBuilder<Message>,
  props: EditorProps<Message>,
  field: typeof EditorTextField.Type,
  label: string,
  type = "text"
): Html =>
  editorInput(h, {
    disabled:
      EditorView.guards.Saving(props.model) ||
      !props.model.permissions.editMeeting,
    id: `event-${field}`,
    label,
    onInput: (value) =>
      props.send(
        EditorAction.cases.TextEdited.make({
          field,
          value: type === "time" ? canonicalClockInput(value) : value,
        })
      ),
    placeholder: textPlaceholders.get(field),
    required: type === "date" || type === "time",
    type: type === "time" ? "text" : type,
    value:
      type === "time"
        ? clockInputLabel(props.model.draft[field], props.timeFormat ?? "12")
        : props.model.draft[field],
  });

export const eventDateFields = <Message>(
  h: HtmlBuilder<Message>,
  props: EditorProps<Message>
): Html => {
  const { draft } = props.model;

  const disabled =
    EditorView.guards.Saving(props.model) ||
    !props.model.permissions.editMeeting;

  return h.section(
    [h.Class("editor-section"), h.AriaLabel("Event dates and times")],
    [
      h.label(
        [h.Class("editor-check")],
        [
          h.input([
            h.Id("event-allDay"),
            h.Type("checkbox"),
            h.Checked(draft.allDay),
            h.Disabled(
              disabled ||
                (props.model.kind === "edit" &&
                  statusEventType(draft.eventType))
            ),
            h.OnClick(props.send(EditorAction.cases.ToggleAllDay.make({}))),
          ]),
          "All day",
        ]
      ),
      h.div(
        [h.Class("editor-row")],
        [
          draftInput(h, props, "startDate", "Start date", "date"),
          draftInput(
            h,
            props,
            "endDate",
            draft.allDay ? "Last day" : "End date",
            "date"
          ),
        ]
      ),
      ...(draft.allDay
        ? []
        : [
            h.div(
              [h.Class("editor-row")],
              [
                draftInput(h, props, "startTime", "Start time", "time"),
                draftInput(h, props, "endTime", "End time", "time"),
              ]
            ),
          ]),
      ...(draft.allDay
        ? []
        : [
            h.label(
              [h.Class("editor-field"), h.For("event-timeZone")],
              [
                h.span([], ["Event time zone"]),
                h.button(
                  [
                    h.Id("event-timeZone"),
                    h.Style({
                      font: "inherit",
                      padding: "8px",
                      "text-align": "left",
                    }),
                    h.Type("button"),
                    h.AriaHasPopup("dialog"),
                    h.Disabled(disabled || props.chooseTimeZone === undefined),
                    ...(props.chooseTimeZone === undefined
                      ? []
                      : [h.OnClick(props.chooseTimeZone)]),
                  ],
                  [eventZoneLabel(draft)]
                ),
              ]
            ),
            ...(props.primaryZone === undefined
              ? []
              : editorZoneExplanation(h, {
                  draft,
                  primaryZone: props.primaryZone,
                  timeFormat: props.timeFormat ?? "12",
                })),
          ]),
    ]
  );
};

export const eventTextFields = <Message>(
  h: HtmlBuilder<Message>,
  props: EditorProps<Message>
): readonly Html[] => [
  draftInput(h, props, "title", "Title"),
  eventDateFields(h, props),
  ...(statusEventType(props.model.draft.eventType)
    ? []
    : [
        draftInput(h, props, "location", "Location"),
        h.label(
          [h.Class("editor-field"), h.For("event-description")],
          [
            h.span([], ["Description"]),
            h.textarea([
              h.Id("event-description"),
              h.Name("description"),
              h.Placeholder("Description"),
              h.Value(props.model.draft.description),
              h.Disabled(
                EditorView.guards.Saving(props.model) ||
                  !props.model.permissions.editMeeting
              ),
              h.OnInput((value) =>
                props.send(
                  EditorAction.cases.TextEdited.make({
                    field: "description",
                    value,
                  })
                )
              ),
            ]),
          ]
        ),
      ]),
];

export const calendarField = <Message>(
  h: HtmlBuilder<Message>,
  props: EditorProps<Message>
): Html => {
  const { draft } = props.model;

  const sourceAccount = Option.match(props.model.original, {
    onNone: () => draft.accountId,
    onSome: (event) => event.accountId,
  });

  const calendars = props.calendars.filter(
    (calendar) =>
      (calendar.accessRole === "owner" || calendar.accessRole === "writer") &&
      (props.model.kind !== "edit" || calendar.accountId === sourceAccount)
  );

  const moveUnavailable =
    props.model.kind === "edit" && props.model.moveSupport === "notAvailable";

  return h.div(
    [h.Class("editor-section")],
    [
      h.label(
        [h.Class("editor-field"), h.For("event-calendar")],
        [
          h.span([], ["Calendar"]),
          h.select(
            [
              h.Id("event-calendar"),
              h.Value(calendarKey(draft.accountId, draft.calendarId)),
              h.Disabled(
                EditorView.guards.Saving(props.model) ||
                  moveUnavailable ||
                  !props.model.permissions.editMeeting
              ),
              h.OnChange((value) =>
                props.send(EditorAction.cases.CalendarSelected.make({ value }))
              ),
            ],
            calendars.map((calendar) =>
              h.option(
                [
                  h.Value(calendarKey(calendar.accountId, calendar.calendarId)),
                  h.Selected(
                    calendar.accountId === draft.accountId &&
                      calendar.calendarId === draft.calendarId
                  ),
                ],
                [calendar.title]
              )
            )
          ),
        ]
      ),
      ...(props.model.kind === "edit"
        ? [
            h.p(
              [h.Class("editor-hint")],
              [
                moveUnavailable
                  ? "Calendar movement is not available yet."
                  : "Moves stay within the same Google account.",
              ]
            ),
          ]
        : []),
    ]
  );
};

export const colourField = <Message>(
  h: HtmlBuilder<Message>,
  props: EditorProps<Message>
): Html => {
  const disabled =
    EditorView.guards.Saving(props.model) ||
    !props.model.permissions.calendarWritable;

  return h.fieldset(
    [
      h.Class("editor-section"),
      h.Role("radiogroup"),
      h.AriaLabel("Event colour"),
      h.Disabled(disabled),
    ],
    [
      h.legend([], ["Event colour"]),
      h.button(
        [
          h.Type("button"),
          h.Id("event-color"),
          h.Class("editor-default-colour"),
          h.Role("radio"),
          h.AriaChecked(props.model.draft.colorId === null),
          h.OnClick(
            props.send(EditorAction.cases.ColorSelected.make({ value: null }))
          ),
        ],
        ["Use calendar colour"]
      ),
      h.div(
        [h.Class("editor-colours")],
        eventPalette.map((colour) =>
          h.button([
            h.Type("button"),
            h.Class("editor-colour"),
            h.Role("radio"),
            h.AriaChecked(
              colour.google !== "" &&
                props.model.draft.colorId === colour.google
            ),
            h.Disabled(colour.google === ""),
            h.AriaLabel(
              colour.google === ""
                ? `${colour.name}: not available in Google Calendar`
                : colour.name
            ),
            h.Title(
              colour.google === ""
                ? `${colour.name}: not available in Google Calendar`
                : colour.name
            ),
            h.Style({
              "background-color": chipColors(colour.hex, props.theme ?? "light")
                .accent,
            }),
            ...(colour.google === ""
              ? []
              : [
                  h.OnClick(
                    props.send(
                      EditorAction.cases.ColorSelected.make({
                        value: colour.google,
                      })
                    )
                  ),
                ]),
          ])
        )
      ),
    ]
  );
};
