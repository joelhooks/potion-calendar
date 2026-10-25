import { Schema } from "effect";

export class AccountDeletionUnavailable extends Schema.TaggedError<AccountDeletionUnavailable>()(
  "AccountDeletionUnavailable",
  {}
) {}
