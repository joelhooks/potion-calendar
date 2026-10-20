import { Schema } from "effect";

export class LastCalendarAccount extends Schema.TaggedError<LastCalendarAccount>()(
  "LastCalendarAccount",
  {
    accountId: Schema.String,
  }
) {}
