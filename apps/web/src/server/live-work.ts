import { SyncResult } from "@calendar/calendar";
import { CalendarRef } from "@calendar/calendar/contracts";
import { Schema } from "effect";

export const LiveWork = Schema.Union([
  Schema.TaggedStruct("Calendar", CalendarRef.fields),
  Schema.TaggedStruct("Inventory", {}),
]).pipe(Schema.toTaggedUnion("_tag"));

export type LiveWorkValue = typeof LiveWork.Type;

export const LiveOutput = Schema.Union([
  Schema.TaggedStruct("Calendar", { result: SyncResult }),
  Schema.TaggedStruct("Inventory", {}),
  Schema.TaggedStruct("Queued", { accepted: Schema.Boolean }),
]).pipe(Schema.toTaggedUnion("_tag"));

export type LiveOutputValue = typeof LiveOutput.Type;

export const liveWorkKey = (work: LiveWorkValue) =>
  LiveWork.guards.Calendar(work)
    ? JSON.stringify([work.accountId, work.calendarId])
    : "inventory";

export const LiveJob = Schema.Struct({
  attempts: Schema.Int,
  dueAt: Schema.Int,
  generation: Schema.NonEmptyString,
  key: Schema.NonEmptyString,
  work: LiveWork,
});

export const StoredLiveJob = Schema.Struct({
  ...LiveJob.fields,
  work: Schema.fromJsonString(LiveWork),
});

export type LiveJobValue = typeof LiveJob.Type;
