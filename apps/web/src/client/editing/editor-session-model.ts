import {
  Calendar,
  CalendarEvent,
  CalendarRef,
  CreateEventInput,
  EditScope,
} from "@calendar/calendar/contracts";
import { Schema } from "effect";

import { NavigationState } from "../../layout/navigation.js";
import {
  ClipboardPasteMetadata,
  ClipboardTemplate,
} from "../clipboard/model.js";
import { EditorConferencingContext } from "./conferencing-draft.js";
import { DeleteIntent } from "./delete-actor.js";
import { EditorAction } from "./editor-action.js";
import { EventDraft, RepeatForm } from "./editor-model.js";
import { MutationFailure } from "./failure.js";
import { GestureRange } from "./gesture-model.js";
import { EditorInputFailure } from "./input-failure.js";
import { MoveSupport } from "./move-support.js";

const openingFields = {
  calendars: Schema.Array(Calendar),
  conferencingContext: Schema.optional(EditorConferencingContext),
  intent: Schema.optionalKey(
    Schema.Literals(["ordinary", "noEmailOccurrence", "noEmailGesture"])
  ),
  navigation: NavigationState,
  primaryZone: Schema.String,
  rangeZone: Schema.optionalKey(Schema.String),
  selection: Schema.Option(Schema.String),
};

export const EditorRequest = Schema.TaggedUnion({
  Existing: {
    ...openingFields,
    event: CalendarEvent,
    mode: Schema.Literals(["edit", "duplicate", "delete"]),
    range: Schema.optionalKey(GestureRange),
  },
  New: {
    ...openingFields,
    allDay: Schema.Boolean,
    endDate: Schema.String,
    endTime: Schema.String,
    ref: CalendarRef,
    startDate: Schema.String,
    startTime: Schema.String,
    template: Schema.optionalKey(ClipboardTemplate),
  },
});

export const LoadedEditor = Schema.Struct({
  baseline: EventDraft,
  calendars: Schema.Array(Calendar),
  clipboard: Schema.optionalKey(ClipboardPasteMetadata),
  conferencingContext: Schema.optional(EditorConferencingContext),
  createId: Schema.Option(CreateEventInput.fields.id),
  direct: Schema.optionalKey(Schema.Boolean),
  draft: EventDraft,
  id: Schema.String,
  intent: Schema.optionalKey(
    Schema.Literals(["ordinary", "noEmailOccurrence", "noEmailGesture"])
  ),
  kind: Schema.Literals(["create", "edit", "duplicate"]),
  master: Schema.Option(CalendarEvent),
  moveSupport: MoveSupport,
  navigation: NavigationState,
  operation: Schema.Literals(["save", "delete"]),
  original: Schema.Option(CalendarEvent),
  selection: Schema.Option(Schema.String),
});

export const WritePlan = Schema.Struct({
  calendarMoved: Schema.Boolean,
  changes: CreateEventInput.fields.event,
  choices: Schema.Array(EditScope),
  dayChanged: Schema.Boolean,
  emailNeeded: Schema.Boolean,
  fields: CreateEventInput.fields.event,
  noEmailOnly: Schema.Boolean,
  prompt: Schema.Literals(["none", "scope", "removeRecurrence", "unavailable"]),
  removeRecurrence: Schema.Boolean,
  scope: EditScope,
  sendUpdates: Schema.Literals(["all", "none"]),
  session: LoadedEditor,
});

export const EditorChangeInput = Schema.Struct({
  action: EditorAction,
  custom: Schema.Option(RepeatForm),
  session: LoadedEditor,
});

export const EditorChangeResult = Schema.TaggedUnion({
  Changed: { session: LoadedEditor },
  Invalid: { message: Schema.String },
});

export const EditorFailure = Schema.Union([
  MutationFailure,
  EditorInputFailure,
]);

export const EditorLoadResult = Schema.TaggedUnion({
  Failed: { failure: EditorFailure },
  Loaded: { session: LoadedEditor },
});

export const EditorPlanResult = Schema.TaggedUnion({
  Invalid: { message: Schema.String },
  Prepared: { plan: WritePlan },
});

export const EditorMutation = Schema.TaggedUnion({
  DeletedStaged: { id: Schema.String, intent: DeleteIntent },
  Saved: { event: CalendarEvent, id: Schema.String, plan: WritePlan },
});

export const EditorWriteResult = Schema.TaggedUnion({
  Failed: { failure: EditorFailure },
  Saved: { mutation: EditorMutation },
});
