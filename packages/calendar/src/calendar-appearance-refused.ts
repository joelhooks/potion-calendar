import { Schema } from "effect";

export class CalendarAppearanceRefused extends Schema.TaggedError<CalendarAppearanceRefused>()(
  "CalendarAppearanceRefused",
  {
    accountId: Schema.String,
    calendarId: Schema.String,
    reason: Schema.Literals(["emptyUpdate", "unknownCalendarColor"]),
  }
) {}
