import { Schema } from "effect";

export class RecurrenceRemovalRefused extends Schema.TaggedError<RecurrenceRemovalRefused>()(
  "RecurrenceRemovalRefused",
  {
    accountId: Schema.String,
    calendarId: Schema.String,
    eventId: Schema.String,
    reason: Schema.Literals([
      "explicitRemovalRequired",
      "wholeSeriesRequired",
      "conflictingRules",
      "missingInstanceTimes",
    ]),
  }
) {}
