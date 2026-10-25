import { defineContract } from "@calendar/capability/define";
import { Schema } from "effect";

import { AccountDeletionRefused } from "./account-deletion-refused.js";
import { AccountDeletionUnavailable } from "./account-deletion-unavailable.js";
import { ProfileUpdateRefused } from "./profile-update-refused.js";
import { ProfileUpdateUnavailable } from "./profile-update-unavailable.js";

export { ProfileUpdateRefused } from "./profile-update-refused.js";

export { ProfileUpdateUnavailable } from "./profile-update-unavailable.js";

export { AccountDeletionRefused } from "./account-deletion-refused.js";

export { AccountDeletionUnavailable } from "./account-deletion-unavailable.js";

export const AccountSummary = Schema.Struct({
  disconnected: Schema.Boolean,
  email: Schema.String,
  id: Schema.String,
});

export const SessionSnapshot = Schema.NullOr(
  Schema.Struct({
    accountDeletionProof: Schema.optionalKey(Schema.String),
    accounts: Schema.Array(AccountSummary),
    profileUpdateProof: Schema.optionalKey(Schema.String),
    user: Schema.Struct({
      email: Schema.String,
      id: Schema.String,
      image: Schema.optionalKey(Schema.String),
      name: Schema.String,
      primaryAccountId: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  })
);

export class SessionUnavailable extends Schema.TaggedError<SessionUnavailable>()(
  "SessionUnavailable",
  {}
) {}

const ConfirmedAccountDeletion = Schema.Struct({
  confirmation: Schema.Literal("permanently-delete-my-account"),
  proof: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
});

const OtherDeletionKeys = Schema.String.check(
  Schema.makeFilter(
    (key) => !Object.hasOwn(ConfirmedAccountDeletion.fields, key)
  )
);

export const DeleteAccountInput = ConfirmedAccountDeletion.rebuild(
  Schema.StructWithRest(ConfirmedAccountDeletion, [
    Schema.Record(OtherDeletionKeys, Schema.Never),
  ]).ast
);

export const deleteAccountContract = defineContract("deleteAccount", {
  annotations: { destructive: true, idempotent: false, readOnly: false },
  description:
    "Permanently delete only the explicitly confirmed current Calendar account.",
  failure: Schema.Union([AccountDeletionRefused, AccountDeletionUnavailable]),
  input: DeleteAccountInput,
  output: Schema.Struct({ deleted: Schema.Literal(true) }),
});

const ConfirmedProfileUpdate = Schema.Struct({
  name: Schema.String,
  primaryAccountId: Schema.optionalKey(Schema.NonEmptyString),
  proof: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
});

const OtherProfileKeys = Schema.String.check(
  Schema.makeFilter((key) => !Object.hasOwn(ConfirmedProfileUpdate.fields, key))
);

export const SaveProfileInput = ConfirmedProfileUpdate.rebuild(
  Schema.StructWithRest(ConfirmedProfileUpdate, [
    Schema.Record(OtherProfileKeys, Schema.Never),
  ]).ast
);

export const SavedProfile = Schema.Struct({
  name: Schema.String,
  primaryAccountId: Schema.NullOr(Schema.String),
});

export const saveProfileContract = defineContract("saveProfile", {
  annotations: { idempotent: true, readOnly: false },
  description:
    "Atomically update the current person's name and optional linked primary Google account.",
  failure: Schema.Union([ProfileUpdateRefused, ProfileUpdateUnavailable]),
  input: SaveProfileInput,
  output: SavedProfile,
});

export const sessionContract = defineContract("session", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "Return the signed-in person and their connected Google accounts.",
  failure: SessionUnavailable,
  input: Schema.Struct({}),
  output: SessionSnapshot,
});
