import { Schema } from "effect";

import { CustomVideoReference } from "./custom-video-link.js";
import { OwnedConference } from "./owned-conference.js";

export const ConferencingRequest = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("googleMeet") }),
  Schema.Struct({ kind: Schema.Literal("none") }),
  CustomVideoReference,
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

export const ConferencingDefault = Schema.Union([
  Schema.Literals(["unset", "none", "googleMeet"]),
  CustomVideoReference,
]);

export const ConferencingStatus = Schema.Literals([
  "pending",
  "ready",
  "failed",
  "unconfirmed",
]);
