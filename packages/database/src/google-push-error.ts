import { Schema } from "effect";

export class GooglePushStoreError extends Schema.TaggedError<GooglePushStoreError>()(
  "GooglePushStoreError",
  {
    operation: Schema.String,
    reason: Schema.Literals(["input", "storage", "storedRow"]),
  }
) {}
