import { Schema } from "effect";

export class ReminderLimitExceeded extends Schema.TaggedError<ReminderLimitExceeded>()(
  "ReminderLimitExceeded",
  {
    accountId: Schema.String,
    actualCount: Schema.Int,
    calendarId: Schema.String,
    maxRemindersCount: Schema.Int,
  }
) {}
