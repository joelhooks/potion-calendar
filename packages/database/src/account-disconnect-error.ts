import { Schema } from "effect";

export class AccountDisconnectStoreError extends Schema.TaggedError<AccountDisconnectStoreError>()(
  "AccountDisconnectStoreError",
  {
    operation: Schema.String,
  }
) {}
