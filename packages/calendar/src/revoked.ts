import { Schema } from "effect";

export class Revoked extends Schema.TaggedError<Revoked>()("Revoked", {
  accountId: Schema.String,
}) {}
