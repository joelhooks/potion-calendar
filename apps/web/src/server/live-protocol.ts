import {
  CalendarChanged,
  CalendarFailure,
  CalendarRef,
} from "@calendar/calendar/contracts";
import { Schema } from "effect";

import { GoogleMessageNumber } from "./google-push-protocol.js";
import { LiveOutput, LiveWork } from "./live-work.js";

const Owner = { personId: Schema.NonEmptyString };

export const LiveCommand = Schema.Union([
  Schema.TaggedStruct("DeleteAccount", Owner),
  Schema.TaggedStruct("Sync", { ...Owner, ref: CalendarRef }),
  Schema.TaggedStruct("Push", {
    ...Owner,
    channelId: Schema.NonEmptyString,
    number: GoogleMessageNumber,
    work: LiveWork,
  }),
  Schema.TaggedStruct("Publish", { ...Owner, change: CalendarChanged }),
  Schema.TaggedStruct("Reconcile", Owner),
  Schema.TaggedStruct("NotifyInventory", Owner),
  Schema.TaggedStruct("StopAccount", {
    ...Owner,
    accountId: Schema.NonEmptyString,
  }),
]).pipe(Schema.toTaggedUnion("_tag"));

export type LiveCommandValue = typeof LiveCommand.Type;

export const LiveReply = Schema.Union([
  Schema.TaggedStruct("Success", { value: Schema.NullOr(LiveOutput) }),
  Schema.TaggedStruct("Failure", { failure: CalendarFailure }),
]).pipe(Schema.toTaggedUnion("_tag"));
