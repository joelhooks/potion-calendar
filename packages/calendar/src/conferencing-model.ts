import { Schema } from "effect";

import { OwnedConference } from "./owned-conference.js";

export const ConferencingRequest = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("googleMeet") }),
  Schema.Struct({ kind: Schema.Literal("none") }),
]);

export type ConferencingRequestValue = typeof ConferencingRequest.Type;

export const ConferencingWriteRequest = Schema.Union([
  ConferencingRequest,
  Schema.Struct({
    conference: OwnedConference,
    kind: Schema.Literal("keepExisting"),
  }),
]);

export type ConferencingWriteRequestValue =
  typeof ConferencingWriteRequest.Type;

export const ConferencingDefault = Schema.Literals([
  "unset",
  "none",
  "googleMeet",
]);

export const ConferencingStatus = Schema.Literals([
  "pending",
  "ready",
  "failed",
  "unconfirmed",
]);
