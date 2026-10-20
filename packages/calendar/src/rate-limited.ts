import { Schema } from "effect";

export class RateLimited extends Schema.TaggedError<RateLimited>()(
  "RateLimited",
  {
    operation: Schema.String,
    retryAfterMs: Schema.Finite,
  }
) {}
