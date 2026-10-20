import { Schema } from "effect";

export class MutationFeatureUnavailable extends Schema.TaggedError<MutationFeatureUnavailable>()(
  "MutationFeatureUnavailable",
  {
    feature: Schema.Literal("calendarMove"),
    message: Schema.String,
  }
) {}
