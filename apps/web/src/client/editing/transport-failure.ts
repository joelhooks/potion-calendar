import { Schema } from "effect";

export class MutationTransportFailure extends Schema.TaggedError<MutationTransportFailure>()(
  "MutationTransportFailure",
  {
    message: Schema.String,
  }
) {}
