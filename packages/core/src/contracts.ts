import { defineContract } from "@calendar/capability/define";
import { Schema } from "effect";

export const AccountSummary = Schema.Struct({
  disconnected: Schema.Boolean,
  email: Schema.String,
  id: Schema.String,
});

export const SessionSnapshot = Schema.NullOr(
  Schema.Struct({
    accounts: Schema.Array(AccountSummary),
    user: Schema.Struct({
      email: Schema.String,
      id: Schema.String,
      name: Schema.String,
    }),
  })
);

export class SessionUnavailable extends Schema.TaggedError<SessionUnavailable>()(
  "SessionUnavailable",
  {}
) {}

export const sessionContract = defineContract("session", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "Return the signed-in person and their connected Google accounts.",
  failure: SessionUnavailable,
  input: Schema.Struct({}),
  output: SessionSnapshot,
});
