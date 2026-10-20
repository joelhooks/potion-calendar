import { Schema } from "effect";

export class CalendarMoveRefused extends Schema.TaggedError<CalendarMoveRefused>()(
  "CalendarMoveRefused",
  {
    accountId: Schema.String,
    calendarId: Schema.String,
    eventId: Schema.String,
    eventType: Schema.optional(Schema.String),
    reason: Schema.Literals(["recurringInstance", "eventType"]),
    recurringEventId: Schema.optional(Schema.String),
  }
) {}
