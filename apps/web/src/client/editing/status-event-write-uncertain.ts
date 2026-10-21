import { Schema } from "effect";

export class StatusEventWriteUncertain extends Schema.TaggedError<StatusEventWriteUncertain>()(
  "StatusEventWriteUncertain",
  {
    accountId: Schema.String,
    calendarId: Schema.String,
    cause: Schema.Defect(),
    eventId: Schema.String,
  }
) {}
