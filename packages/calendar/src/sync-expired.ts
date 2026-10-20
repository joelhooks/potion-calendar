import { Schema } from "effect";

export class SyncExpired extends Schema.TaggedError<SyncExpired>()(
  "SyncExpired",
  {
    version: Schema.Int,
  }
) {}
