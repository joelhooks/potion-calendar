import {
  Attendee,
  CalendarEvent,
  EditScope,
  Reminder,
} from "@calendar/calendar/contracts";
import { Schema } from "effect";

import { ConferencingDraft } from "./conferencing-draft.js";
import { MutationFailure } from "./failure.js";
import { MoveSupport } from "./move-support.js";

export const Weekday = Schema.Literals([
  "SU",
  "MO",
  "TU",
  "WE",
  "TH",
  "FR",
  "SA",
]);

export const RepeatPreset = Schema.Literals([
  "none",
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "yearly",
  "custom",
  "unchanged",
]);

export const RepeatForm = Schema.Struct({
  count: Schema.String,
  end: Schema.Literals(["never", "on", "after"]),
  frequency: Schema.Literals(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
  interval: Schema.String,
  monthPattern: Schema.Literals(["date", "weekday"]),
  ordinal: Schema.Literals(["1", "2", "3", "4", "5", "-1"]),
  preset: RepeatPreset,
  rules: Schema.Array(Schema.String),
  until: Schema.String,
  weekday: Weekday,
  weekdays: Schema.Array(Weekday),
});

export const EventDraft = Schema.Struct({
  accountId: Schema.String,
  allDay: Schema.Boolean,
  attachments: CalendarEvent.fields.attachments,
  attendees: Schema.Array(Attendee),
  calendarId: Schema.String,
  colorId: Schema.NullOr(Schema.String),
  conferencing: Schema.optional(ConferencingDraft),
  description: Schema.String,
  endDate: Schema.String,
  endTime: Schema.String,
  eventType: CalendarEvent.fields.eventType,
  location: Schema.String,
  participantEmail: Schema.String,
  reminderInput: Schema.String,
  reminders: Schema.Struct({
    overrides: Schema.Array(Reminder),
    useDefault: Schema.Boolean,
  }),
  repeat: RepeatForm,
  startDate: Schema.String,
  startTime: Schema.String,
  statusInvitationChoice: Schema.optional(
    Schema.Literals([
      "declineNone",
      "declineOnlyNewConflictingInvitations",
      "declineAllConflictingInvitations",
    ])
  ),
  timeZone: Schema.String,
  title: Schema.String,
});

export const EditorPermissions = Schema.Struct({
  calendarWritable: Schema.Boolean,
  editGuests: Schema.Boolean,
  editMeeting: Schema.Boolean,
  inviteGuests: Schema.Boolean,
});

const editorFields = {
  draft: EventDraft,
  error: Schema.Option(Schema.String),
  kind: Schema.Literals(["create", "edit", "duplicate"]),
  moveSupport: MoveSupport,
  operation: Schema.Literals(["save", "delete"]),
  original: Schema.Option(CalendarEvent),
  permissions: EditorPermissions,
};

export const EditorView = Schema.TaggedUnion({
  Closed: {},
  ConfirmConferencing: editorFields,
  CustomRepeat: { ...editorFields, custom: RepeatForm },
  Editing: editorFields,
  Email: editorFields,
  Failure: { ...editorFields, failure: MutationFailure },
  Loading: { label: Schema.String },
  RemoveRecurrence: editorFields,
  Saving: editorFields,
  Scope: {
    ...editorFields,
    choices: Schema.Array(EditScope),
    selected: Schema.Option(EditScope),
  },
});

export type EventDraftValue = typeof EventDraft.Type;

export type EditorViewValue = typeof EditorView.Type;
