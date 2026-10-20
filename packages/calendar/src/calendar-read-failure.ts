import { Schema } from "effect";

import { CalendarFailure } from "./errors.js";

export class CalendarReadFailure extends Schema.TaggedError<CalendarReadFailure>()(
  "CalendarReadFailure",
  {
    accountId: Schema.String,
    calendarId: Schema.String,
    cause: CalendarFailure,
  }
) {}
