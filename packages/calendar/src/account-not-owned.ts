import { Schema } from "effect";

export class AccountNotOwned extends Schema.TaggedError<AccountNotOwned>()(
  "AccountNotOwned",
  {
    accountId: Schema.String,
  }
) {}
