import { Schema } from "effect";

export class EditorInputFailure extends Schema.TaggedError<EditorInputFailure>()(
  "EditorInputFailure",
  { message: Schema.String }
) {}
