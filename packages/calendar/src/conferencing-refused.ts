import { Schema } from "effect";

export class ConferencingRefused extends Schema.TaggedError<ConferencingRefused>()(
  "ConferencingRefused",
  {
    accountId: Schema.String,
    calendarId: Schema.String,
    reason: Schema.Literals([
      "calendarUnsupported",
      "calendarReadOnly",
      "eventTypeUnsupported",
      "existingConferenceUnrepresentable",
    ]),
  }
) {}
