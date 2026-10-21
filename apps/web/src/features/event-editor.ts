import { statusEventType } from "@calendar/calendar/contracts";
import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import { EditorAction } from "../client/editing/editor-action.js";
import { EditorView } from "../client/editing/editor-model.js";
import type { EditorViewValue } from "../client/editing/editor-model.js";
import { needsCalendarReview } from "../client/editing/failure.js";
import { statusInsertRefusal } from "../client/editing/status-event-draft.js";
import { mutationFailureMessage } from "../layout/mutation-failure.js";
import { conferencingField } from "./editor-conferencing.js";
import { editorDialog } from "./editor-dialog.js";
import { eventTypeField } from "./editor-event-type.js";
import {
  calendarField,
  colourField,
  eventTextFields,
} from "./editor-fields.js";
import type { EditorProps } from "./editor-fields.js";
import {
  participantFields,
  reminderFields,
} from "./editor-guests-reminders.js";
import { customRepeatDialog, repeatField } from "./editor-repeat.js";
import { editorLinks } from "./event-links.js";

const initialEditorFocus = <Message>(props: EditorProps<Message>): string => {
  if (
    props.initialFocus === "event-calendar" &&
    (props.model.moveSupport === "notAvailable" ||
      !props.model.permissions.editMeeting)
  ) {
    return "event-color";
  }

  if (
    props.initialFocus === "event-reminderInput" &&
    props.model.draft.reminders.useDefault
  ) {
    return "event-defaultReminders";
  }

  return props.initialFocus ?? "event-title";
};

const editorFailureFields = <Message>(
  h: HtmlBuilder<Message>,
  props: EditorProps<Message>
): readonly Html[] => {
  if (!EditorView.guards.Failure(props.model)) {
    return [];
  }

  const refusal = statusInsertRefusal(props.model, props.model.failure);

  return [
    h.p(
      [h.Role("alert"), h.Class("editor-error")],
      [refusal ?? mutationFailureMessage(props.model.failure)]
    ),
    ...(refusal === undefined
      ? []
      : [
          h.button(
            [
              h.Id("event-save-as-event"),
              h.Type("button"),
              h.OnClick(props.send(EditorAction.cases.SaveAsEvent.make({}))),
            ],
            ["Save as event"]
          ),
        ]),
  ];
};

const editorForm = <Message>(
  h: HtmlBuilder<Message>,
  props: EditorProps<Message>
): Html => {
  if (
    EditorView.guards.Failure(props.model) &&
    needsCalendarReview(props.model.failure)
  ) {
    return editorDialog(h, {
      body: [
        h.p(
          [h.Role("alert"), h.Class("editor-error")],
          [mutationFailureMessage(props.model.failure, props.calendars)]
        ),
      ],
      confirm: EditorAction.cases.Cancel.make({}),
      confirmLabel: "Close",
      dismissOnly: true,
      id: "event-recovery-dialog",
      initialFocus: "event-recovery-dialog-confirm",
      label: "Review calendar state",
      send: props.send,
    });
  }

  const busy = EditorView.guards.Saving(props.model);

  const titles = {
    create: "New event",
    duplicate: "Duplicate event",
    edit: "Edit event",
  };

  return editorDialog(h, {
    body: [
      ...(props.model.kind === "duplicate"
        ? [
            h.p(
              [h.Class("editor-hint")],
              [
                "Only this occurrence is copied. Repeat and native conference details are not copied.",
              ]
            ),
          ]
        : []),
      ...(props.model.permissions.editMeeting
        ? []
        : [
            h.p(
              [h.Class("editor-hint")],
              [
                props.model.permissions.calendarWritable
                  ? "You can manage your copy's colour and reminders. Other fields are read-only."
                  : "This calendar is read-only.",
              ]
            ),
          ]),
      eventTypeField(h, props),
      ...eventTextFields(h, props),
      ...(statusEventType(props.model.draft.eventType)
        ? []
        : [editorLinks(h, props.model.draft, props.locationMaps)]),
      ...(statusEventType(props.model.draft.eventType)
        ? []
        : [conferencingField(h, props)]),
      repeatField(h, props),
      calendarField(h, props),
      colourField(h, props),
      ...(statusEventType(props.model.draft.eventType)
        ? []
        : [participantFields(h, props)]),
      reminderFields(h, props),
      ...(Option.isSome(props.model.error)
        ? [
            h.p(
              [h.Role("alert"), h.Class("editor-error")],
              [props.model.error.value]
            ),
          ]
        : []),
      ...editorFailureFields(h, props),
    ],
    cancelDisabled: busy,
    confirm: EditorView.guards.Failure(props.model)
      ? EditorAction.cases.Retry.make({})
      : EditorAction.cases.Save.make({}),
    confirmDisabled: busy || !props.model.permissions.calendarWritable,
    confirmLabel: busy ? "Saving…" : "Save",
    extra:
      EditorView.guards.Scope(props.model) ||
      EditorView.guards.Email(props.model) ||
      EditorView.guards.RemoveRecurrence(props.model) ||
      EditorView.guards.CustomRepeat(props.model) ||
      EditorView.guards.ConfirmConferencing(props.model)
        ? undefined
        : props.toast,
    id: "event-editor-dialog",
    initialFocus: initialEditorFocus(props),
    label: titles[props.model.kind],
    send: props.send,
  });
};

const scopeLabels = {
  all: "All events",
  allFollowing: "This and following events",
  single: "This event",
};

const scopeDialog = <Message>(
  h: HtmlBuilder<Message>,
  props: Omit<EditorProps<Message>, "model"> & {
    readonly model: typeof EditorView.cases.Scope.Type;
  }
): Html =>
  editorDialog(h, {
    body: [
      h.p([], ["Which occurrences should change?"]),
      h.fieldset(
        [h.Class("editor-scope-options")],
        [
          h.legend([], ["Repeat scope"]),
          ...props.model.choices.map((choice) =>
            h.label(
              [h.Class("editor-check")],
              [
                h.input([
                  h.Type("radio"),
                  h.Name("repeat-scope"),
                  h.Value(choice),
                  h.Checked(
                    Option.getOrUndefined(props.model.selected) === choice
                  ),
                  h.OnClick(
                    props.send(
                      EditorAction.cases.ScopeSelected.make({ value: choice })
                    )
                  ),
                ]),
                scopeLabels[choice],
              ]
            )
          ),
        ]
      ),
      ...(props.model.choices.length === 0
        ? [
            h.p(
              [h.Role("alert")],
              [
                "This combination of changes has no supported scope. Make these changes separately.",
              ]
            ),
          ]
        : []),
    ],
    confirm: EditorAction.cases.ConfirmScope.make({}),
    confirmDisabled: Option.isNone(props.model.selected),
    confirmLabel: "Continue",
    extra: props.toast,
    id: "repeat-scope-dialog",
    initialFocus: "repeat-scope-dialog-confirm",
    label:
      props.model.operation === "delete"
        ? "Delete repeat event"
        : "Edit repeat event",
    send: props.send,
  });

const emailDialog = <Message>(
  h: HtmlBuilder<Message>,
  props: EditorProps<Message>
): Html =>
  editorDialog(h, {
    body: [
      h.p(
        [],
        ["There are other guests. Choose whether Google sends an email update."]
      ),
      h.button(
        [
          h.Type("button"),
          h.Id("send-email-update"),
          h.OnClick(
            props.send(EditorAction.cases.SendUpdates.make({ send: true }))
          ),
        ],
        ["Send update with email"]
      ),
    ],
    confirm: EditorAction.cases.SendUpdates.make({ send: false }),
    confirmLabel: "Don't send",
    extra: props.toast,
    id: "email-update-dialog",
    initialFocus: "email-update-dialog-confirm",
    label: "Send update with email?",
    send: props.send,
  });

const removalDialog = <Message>(
  h: HtmlBuilder<Message>,
  props: EditorProps<Message>
): Html =>
  editorDialog(h, {
    body: [
      h.p(
        [],
        [
          "Removing repeat keeps this occurrence as an ordinary event. The other occurrences in the series will be removed.",
        ]
      ),
    ],
    confirm: EditorAction.cases.ConfirmRemoval.make({}),
    confirmLabel: "Remove repeat",
    extra: props.toast,
    id: "remove-repeat-dialog",
    initialFocus: "remove-repeat-dialog-confirm",
    label: "Remove repeat?",
    send: props.send,
  });

export const editorDialogs = <Message>(
  h: HtmlBuilder<Message>,
  input: Omit<EditorProps<Message>, "model"> & {
    readonly model: EditorViewValue;
  }
): readonly Html[] => {
  const { model } = input;

  if (EditorView.guards.Closed(model)) {
    return [];
  }

  if (EditorView.guards.Loading(model)) {
    return [
      editorDialog(h, {
        body: [h.p([h.Role("status")], [model.label])],
        confirm: EditorAction.cases.Save.make({}),
        confirmDisabled: true,
        confirmLabel: "Loading…",
        id: "loading-editor-dialog",
        initialFocus: "loading-editor-dialog",
        label: "Preparing event",
        send: input.send,
      }),
    ];
  }

  const props = { ...input, model };
  const dialogs = model.operation === "save" ? [editorForm(h, props)] : [];

  if (EditorView.guards.ConfirmConferencing(model)) {
    dialogs.push(
      editorDialog(h, {
        body: [
          h.p(
            [],
            [
              "This removes the current link, including meeting links in Location and Description, and adds a new Google Meet link when you save.",
            ]
          ),
        ],
        compact: true,
        confirm: EditorAction.cases.ConfirmConferencing.make({}),
        confirmLabel: "Replace with Google Meet",
        extra: props.toast,
        id: "replace-conferencing-dialog",
        initialFocus: "replace-conferencing-dialog-confirm",
        label: "Replace the meeting link?",
        send: props.send,
      })
    );
  }

  if (EditorView.guards.Scope(model)) {
    dialogs.push(scopeDialog(h, { ...input, model }));
  }

  if (EditorView.guards.Email(model)) {
    dialogs.push(emailDialog(h, props));
  }

  if (EditorView.guards.RemoveRecurrence(model)) {
    dialogs.push(removalDialog(h, props));
  }

  if (EditorView.guards.CustomRepeat(model)) {
    dialogs.push(customRepeatDialog(h, { ...input, model }));
  }

  return dialogs;
};
