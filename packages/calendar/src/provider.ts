import { Schema } from "effect";

export const GoogleFailureReason = Schema.String.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9_.-]{0,95}$/u)
);

export class Provider extends Schema.TaggedError<Provider>()("Provider", {
  message: Schema.String,
  operation: Schema.String,
  reason: Schema.optional(GoogleFailureReason),
  reasons: Schema.optional(Schema.Array(GoogleFailureReason)),
  status: Schema.Finite,
}) {}
