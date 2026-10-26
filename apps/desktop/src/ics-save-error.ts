import { Schema } from "effect";

export class IcsSaveError extends Schema.TaggedError<IcsSaveError>()(
  "IcsSaveError",
  { reason: Schema.Literals(["dialog", "write"]) }
) {}
