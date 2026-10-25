import { Schema } from "effect";

export class ProfileUpdateRefused extends Schema.TaggedError<ProfileUpdateRefused>()(
  "ProfileUpdateRefused",
  {}
) {}
