import { Schema } from "effect";

export class CustomVideoLinksStoreError extends Schema.TaggedError<CustomVideoLinksStoreError>()(
  "CustomVideoLinksStoreError",
  { operation: Schema.String }
) {}
