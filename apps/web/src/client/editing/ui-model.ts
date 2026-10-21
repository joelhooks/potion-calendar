import { Schema } from "effect";

import { BulkView } from "../bulk/model.js";
import { ConferencingSaveNotice } from "../conferencing/model.js";
import { MonthGestureRefused } from "../month/gesture.js";
import { DeleteIntent, DeleteOutcome } from "./delete-actor.js";
import { EditorView } from "./editor-model.js";
import { WritePlan } from "./editor-session-model.js";
import { GestureResult } from "./gesture-model.js";
import { RsvpIntent, RsvpView } from "./rsvp-machine.js";

export const DeleteMark = Schema.Struct({
  afterRead: Schema.Option(Schema.Int),
  intent: DeleteIntent,
  phase: Schema.Literals(["pending", "committing", "acknowledged"]),
});

export const WriteMark = Schema.Struct({
  afterRead: Schema.Option(Schema.Int),
  plan: WritePlan,
});

export const RsvpMark = Schema.Struct({
  afterRead: Schema.Option(Schema.Int),
  intent: RsvpIntent,
});

export const EditingUi = Schema.Struct({
  bulk: BulkView,
  bulkOutcomes: Schema.Record(Schema.String, DeleteOutcome),
  conferencingResult: Schema.Option(ConferencingSaveNotice),
  deletes: Schema.Array(DeleteMark),
  gesture: Schema.Option(GestureResult),
  gestureRefusal: Schema.Option(MonthGestureRefused.fields.reason),
  handledBulk: Schema.Option(Schema.String),
  handledMutation: Schema.Option(Schema.String),
  handledRecovery: Schema.Option(Schema.String),
  handledResponse: Schema.Int,
  owner: Schema.Option(Schema.String),
  response: Schema.Option(RsvpMark),
  rsvp: RsvpView,
  view: EditorView,
  write: Schema.Option(WriteMark),
});
