import { Schema } from "effect";

export class AccountConferencingDefaultStoreError extends Schema.TaggedError<AccountConferencingDefaultStoreError>()(
  "AccountConferencingDefaultStoreError",
  { operation: Schema.String }
) {}
