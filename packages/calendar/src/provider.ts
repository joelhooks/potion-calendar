import { Schema } from "effect";

export class Provider extends Schema.TaggedError<Provider>()("Provider", {
  message: Schema.String,
  operation: Schema.String,
  status: Schema.Finite,
}) {}
