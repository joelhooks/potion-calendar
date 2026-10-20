import { Schema } from "effect";

export const SyncResult = Schema.Struct({
  changed: Schema.Int,
  cursor: Schema.String,
  version: Schema.Int,
});

export type SyncResultValue = typeof SyncResult.Type;
