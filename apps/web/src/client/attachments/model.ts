import { CalendarEvent } from "@calendar/calendar/contracts";
import { Schema } from "effect";

export const AttachmentReads = Schema.Struct({
  nextRequestId: Schema.Int,
  reads: Schema.Record(
    Schema.String,
    Schema.Struct({
      phase: Schema.Literals(["loading", "settled"]),
      requestId: Schema.Int,
      signature: Schema.String,
    })
  ),
});

export const initialAttachmentReads = AttachmentReads.make({
  nextRequestId: 0,
  reads: {},
});

export const AttachmentReadResult = Schema.Struct({
  event: Schema.Option(CalendarEvent),
  original: CalendarEvent,
  personId: Schema.String,
  requestId: Schema.Int,
});
