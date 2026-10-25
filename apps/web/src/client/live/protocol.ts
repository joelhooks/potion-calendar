import { CalendarChanged } from "@calendar/calendar/contracts";
import { Schema } from "effect";

export const LiveFrame = Schema.Union([
  CalendarChanged,
  Schema.TaggedStruct("CalendarListChanged", {}),
]);

export const LiveNotice = Schema.Union([
  Schema.TaggedStruct("CalendarChanged", { change: CalendarChanged }),
  Schema.TaggedStruct("InventoryChanged", {}),
  Schema.TaggedStruct("Reconnected", {}),
  Schema.TaggedStruct("SessionEnded", { deleted: Schema.Boolean }),
]).pipe(Schema.toTaggedUnion("_tag"));

export type LiveFrameValue = typeof LiveFrame.Type;

export type LiveNoticeValue = typeof LiveNotice.Type;
