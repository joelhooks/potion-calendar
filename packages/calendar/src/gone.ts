import { Schema } from "effect";

export class Gone extends Schema.TaggedError<Gone>()("Gone", {
  operation: Schema.String,
}) {}
