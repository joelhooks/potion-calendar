import { Schema } from "effect";

export class GoogleTokensError extends Schema.TaggedError<GoogleTokensError>()(
  "GoogleTokensError",
  {
    accountId: Schema.String,
    reason: Schema.Literals([
      "unavailable",
      "disconnected",
      "provider",
      "storage",
    ]),
  }
) {}
