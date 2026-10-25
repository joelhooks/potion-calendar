import { Schema } from "effect";

export class AccountDeletionRefused extends Schema.TaggedError<AccountDeletionRefused>()(
  "AccountDeletionRefused",
  {}
) {}
