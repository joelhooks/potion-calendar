import { defineContract } from "@calendar/capability/contract";
import { Schema } from "effect";

import { AccountNotOwned } from "./account-not-owned.js";
import { ConferencingDefault } from "./conferencing-model.js";
import { NotConnected, Provider, Revoked } from "./errors.js";

export const GetAccountConferencingDefaultInput = Schema.Struct({
  accountId: Schema.NonEmptyString,
});

export const AccountConferencingDefault = Schema.Struct({
  accountId: Schema.NonEmptyString,
  value: ConferencingDefault,
});

export const SetAccountConferencingDefaultInput = AccountConferencingDefault;

export const AccountConferencingDefaultFailure = Schema.Union([
  AccountNotOwned,
  NotConnected,
  Provider,
  Revoked,
]);

export const getAccountConferencingDefaultContract = defineContract(
  "getAccountConferencingDefault",
  {
    annotations: { idempotent: true, readOnly: true },
    description:
      "Read the owned connection's conferencing override; unset is unresolved inheritance, not a provider choice",
    failure: AccountConferencingDefaultFailure,
    input: GetAccountConferencingDefaultInput,
    output: AccountConferencingDefault,
  }
);

export const setAccountConferencingDefaultContract = defineContract(
  "setAccountConferencingDefault",
  {
    annotations: { idempotent: true, readOnly: false },
    description:
      "Set an owned active connection's application conferencing override without changing Google settings",
    failure: AccountConferencingDefaultFailure,
    input: SetAccountConferencingDefaultInput,
    output: AccountConferencingDefault,
  }
);
