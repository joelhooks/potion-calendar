import { Schema } from "effect";

export class ProfileUpdateUnavailable extends Schema.TaggedError<ProfileUpdateUnavailable>()(
  "ProfileUpdateUnavailable",
  {}
) {}
