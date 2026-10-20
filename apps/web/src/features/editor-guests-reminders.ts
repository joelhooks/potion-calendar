import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import { EditorAction } from "../client/editing/editor-action.js";
import { EditorView } from "../client/editing/editor-model.js";
import { editorInput } from "./editor-fields.js";
import type { EditorProps } from "./editor-fields.js";

export const participantFields = <Message>(
  h: HtmlBuilder<Message>,
  props: EditorProps<Message>
): Html => {
  const { draft, permissions } = props.model;
  const busy = EditorView.guards.Saving(props.model);

  return h.section(
    [h.Class("editor-section"), h.AriaLabel("Participants")],
    [
      h.h3([], ["Participants"]),
      h.ul(
        [h.Class("editor-list")],
        draft.attendees.map((person) =>
          h.li(
            [h.Class("editor-participant")],
            [
              h.span(
                [],
                [`${person.email}${person.self === true ? " (you)" : ""}`]
              ),
              h.button(
                [
                  h.Type("button"),
                  h.AriaLabel(`Mark ${person.email} optional`),
                  h.AriaPressed(String(person.optional === true)),
                  h.Disabled(
                    busy ||
                      !permissions.editGuests ||
                      person.self === true ||
                      person.organizer === true
                  ),
                  h.OnClick(
                    props.send(
                      EditorAction.cases.ParticipantOptional.make({
                        email: person.email,
                      })
                    )
                  ),
                ],
                [person.optional === true ? "Optional" : "Required"]
              ),
              h.button(
                [
                  h.Type("button"),
                  h.AriaLabel(`Remove ${person.email}`),
                  h.Disabled(
                    busy ||
                      !permissions.editGuests ||
                      person.self === true ||
                      person.organizer === true
                  ),
                  h.OnClick(
                    props.send(
                      EditorAction.cases.RemoveParticipant.make({
                        email: person.email,
                      })
                    )
                  ),
                ],
                ["Remove"]
              ),
            ]
          )
        )
      ),
      h.div(
        [h.Class("editor-add")],
        [
          h.label(
            [h.Class("editor-field"), h.For("event-participantEmail")],
            [
              h.span([], ["Email address"]),
              h.input([
                h.Id("event-participantEmail"),
                h.Type("email"),
                h.Value(draft.participantEmail),
                h.Disabled(busy || !permissions.inviteGuests),
                h.OnInput((value) =>
                  props.send(
                    EditorAction.cases.TextEdited.make({
                      field: "participantEmail",
                      value,
                    })
                  )
                ),
                h.OnKeyDownPreventDefault((key, modifiers) =>
                  key === "Enter" && !modifiers.ctrlKey && !modifiers.metaKey
                    ? Option.some(
                        props.send(EditorAction.cases.AddParticipant.make({}))
                      )
                    : Option.none()
                ),
              ]),
            ]
          ),
          h.button(
            [
              h.Type("button"),
              h.Disabled(
                busy ||
                  !permissions.inviteGuests ||
                  draft.participantEmail.trim() === ""
              ),
              h.OnClick(props.send(EditorAction.cases.AddParticipant.make({}))),
            ],
            ["Add participant"]
          ),
        ]
      ),
      ...(permissions.editGuests
        ? []
        : [
            h.p(
              [h.Class("editor-hint")],
              [
                "Guest permissions come from Google. Unavailable controls remain read-only.",
              ]
            ),
          ]),
    ]
  );
};

export const reminderLabel = (minutes: number): string => {
  if (minutes === 0) {
    return "At start";
  }

  for (const unit of [
    { label: "week", size: 10_080 },
    { label: "day", size: 1440 },
    { label: "hour", size: 60 },
  ]) {
    if (minutes % unit.size === 0) {
      const count = minutes / unit.size;

      return `${count} ${unit.label}${count === 1 ? "" : "s"} before`;
    }
  }

  return `${minutes} minute${minutes === 1 ? "" : "s"} before`;
};

export const reminderFields = <Message>(
  h: HtmlBuilder<Message>,
  props: EditorProps<Message>
): Html => {
  const { draft } = props.model;

  const calendar = props.calendars.find(
    (item) =>
      item.accountId === draft.accountId && item.calendarId === draft.calendarId
  );

  const defaults = calendar?.defaultReminders;

  const reminders = draft.reminders.useDefault
    ? (defaults ?? [])
    : draft.reminders.overrides;

  const atLimit = reminders.length >= props.reminderLimit;

  const disabled =
    EditorView.guards.Saving(props.model) ||
    !props.model.permissions.calendarWritable;

  const customDisabled = disabled || draft.reminders.useDefault;

  const suggestions = draft.allDay
    ? [0, 1440, 2880, 4320, 10_080]
    : [0, 5, 10, 30, 60];

  return h.section(
    [h.Class("editor-section"), h.AriaLabel("Reminders")],
    [
      h.h3([], ["Reminders"]),
      h.label(
        [h.Class("editor-check")],
        [
          h.input([
            h.Id("event-defaultReminders"),
            h.Type("checkbox"),
            h.Checked(draft.reminders.useDefault),
            h.Disabled(disabled),
            h.OnClick(
              props.send(EditorAction.cases.ToggleDefaultReminders.make({}))
            ),
          ]),
          "Use calendar defaults",
        ]
      ),
      ...(draft.reminders.useDefault && defaults === undefined
        ? [
            h.p(
              [h.Class("editor-hint")],
              [
                "Google manages the calendar defaults. Their values are not available here.",
              ]
            ),
          ]
        : []),
      h.ul(
        [h.Class("editor-list")],
        reminders.map((reminder) =>
          h.li(
            [
              h.Class("editor-reminder"),
              h.DataAttribute("reminder-minutes", String(reminder.minutes)),
            ],
            [
              h.span(
                [],
                [
                  `${reminder.method === "email" ? "Email" : "Notification"}: ${reminderLabel(reminder.minutes)}`,
                ]
              ),
              h.button(
                [
                  h.Type("button"),
                  h.Disabled(customDisabled),
                  h.AriaLabel(
                    `Remove ${reminder.method} reminder ${reminder.minutes} minutes before`
                  ),
                  h.OnClick(
                    props.send(
                      EditorAction.cases.RemoveReminder.make({ reminder })
                    )
                  ),
                ],
                ["Remove"]
              ),
            ]
          )
        )
      ),
      h.select(
        [
          h.AriaLabel("Reminder suggestions"),
          h.Value(""),
          h.Disabled(customDisabled || atLimit),
          h.OnChange((value) =>
            props.send(EditorAction.cases.SuggestReminder.make({ value }))
          ),
        ],
        [
          h.option(
            [h.Value(""), h.Disabled(true), h.Selected(true)],
            ["Add a reminder…"]
          ),
          ...suggestions.map((minutes) =>
            h.option(
              [
                h.Value(String(minutes)),
                h.Disabled(
                  reminders.some((reminder) => reminder.minutes === minutes)
                ),
              ],
              [reminderLabel(minutes)]
            )
          ),
        ]
      ),
      h.div(
        [h.Class("editor-add")],
        [
          editorInput(h, {
            disabled: customDisabled || atLimit,
            id: "event-reminderInput",
            label: "Custom reminder",
            onInput: (value) =>
              props.send(
                EditorAction.cases.TextEdited.make({
                  field: "reminderInput",
                  value,
                })
              ),
            value: draft.reminderInput,
          }),
          h.button(
            [
              h.Type("button"),
              h.Disabled(
                customDisabled || atLimit || draft.reminderInput.trim() === ""
              ),
              h.OnClick(props.send(EditorAction.cases.AddReminder.make({}))),
            ],
            ["Add reminder"]
          ),
        ]
      ),
      h.p(
        [h.Class("editor-hint")],
        [
          atLimit
            ? `Reminders limited to ${props.reminderLimit}`
            : "Use minutes, hours, days or weeks, for example 2 h 45 m.",
        ]
      ),
    ]
  );
};
