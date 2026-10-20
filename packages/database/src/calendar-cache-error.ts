import { Schema } from "effect";

export class CalendarCacheError extends Schema.TaggedError<CalendarCacheError>()(
  "CalendarCacheError",
  {
    operation: Schema.String,
  }
) {}
