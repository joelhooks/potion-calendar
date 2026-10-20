import { Schema } from "effect";

export class Provider extends Schema.TaggedError<Provider>()("Provider", {
  message: Schema.String,
  operation: Schema.String,
  reason: Schema.optional(
    Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9_.-]{0,95}$/u))
  ),
  status: Schema.Finite,
}) {}
