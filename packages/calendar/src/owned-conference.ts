import { Schema } from "effect";

export const ConferenceEntryPoint = Schema.Struct({
  accessCode: Schema.optional(Schema.String),
  kind: Schema.Literals(["video", "phone", "sip", "more"]),
  label: Schema.optional(Schema.String),
  meetingCode: Schema.optional(Schema.String),
  passcode: Schema.optional(Schema.String),
  password: Schema.optional(Schema.String),
  pin: Schema.optional(Schema.String),
  uri: Schema.NonEmptyString,
});

const conferenceFields = {
  entryPoints: Schema.Array(ConferenceEntryPoint).check(Schema.isMinLength(1)),
  notes: Schema.optional(Schema.String),
  signature: Schema.optional(Schema.String),
  solutionIconUrl: Schema.optional(Schema.String),
  solutionName: Schema.optional(Schema.String),
};

export const OwnedConference = Schema.Union([
  Schema.Struct({
    ...conferenceFields,
    id: Schema.NonEmptyString,
    kind: Schema.Literal("googleMeet"),
  }),
  Schema.Struct({
    ...conferenceFields,
    id: Schema.optional(Schema.NonEmptyString),
    kind: Schema.Literal("legacyHangout"),
  }),
  Schema.Struct({
    ...conferenceFields,
    id: Schema.NonEmptyString,
    kind: Schema.Literal("legacyNamedHangout"),
  }),
  Schema.Struct({
    ...conferenceFields,
    id: Schema.optional(Schema.NonEmptyString),
    kind: Schema.Literal("thirdParty"),
  }),
]);

export type OwnedConferenceValue = typeof OwnedConference.Type;

export const ConferenceDetails = Schema.Union([
  OwnedConference,
  Schema.Struct({ kind: Schema.Literal("unrepresentable") }),
]);

export type ConferenceDetailsValue = typeof ConferenceDetails.Type;
