import { EditScope, Reminder } from "@calendar/calendar/contracts";
import { Schema } from "effect";

import { Weekday } from "./editor-model.js";

export const EditorTextField = Schema.Literals([
  "description",
  "endDate",
  "endTime",
  "location",
  "participantEmail",
  "reminderInput",
  "startDate",
  "startTime",
  "title",
]);

export const RepeatTextField = Schema.Literals([
  "count",
  "end",
  "frequency",
  "interval",
  "monthPattern",
  "ordinal",
  "until",
  "weekday",
]);

export const EditorAction = Schema.TaggedUnion({
  AddParticipant: {},
  AddReminder: {},
  CalendarSelected: { value: Schema.String },
  Cancel: {},
  ColorSelected: { value: Schema.NullOr(Schema.String) },
  ConfirmRemoval: {},
  ConfirmScope: {},
  DeleteSelected: {},
  DismissUndo: { id: Schema.String },
  DuplicateSelected: {},
  OpenCreate: {},
  OpenEdit: {},
  ParticipantOptional: { email: Schema.String },
  RemoveParticipant: { email: Schema.String },
  RemoveReminder: { reminder: Reminder },
  RepeatAccepted: {},
  RepeatFieldEdited: { field: RepeatTextField, value: Schema.String },
  RepeatPresetSelected: { value: Schema.String },
  RepeatWeekdayToggled: { weekday: Weekday },
  Retry: {},
  Rsvp: { response: Schema.Literals(["accepted", "declined", "tentative"]) },
  RsvpNoteEdited: { value: Schema.String },
  Save: {},
  ScopeSelected: { value: EditScope },
  SendUpdates: { send: Schema.Boolean },
  SuggestReminder: { value: Schema.String },
  TextEdited: { field: EditorTextField, value: Schema.String },
  TimeZoneSelected: { value: Schema.String },
  ToggleAllDay: {},
  ToggleDefaultReminders: {},
  Undo: { id: Schema.String },
});
