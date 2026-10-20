import { Schema } from "effect";

export const GoogleMessageNumber = Schema.String.check(
  Schema.isPattern(/^[0-9]+$/u)
);

export const GooglePushEnvelope = Schema.Struct({
  channelId: Schema.NonEmptyString,
  messageNumber: GoogleMessageNumber,
  resourceId: Schema.NonEmptyString,
  state: Schema.Literals(["sync", "exists", "not_exists"]),
  token: Schema.RedactedFromValue(Schema.String),
});
