import { Schema } from "effect";

export class CrossAccountMove extends Schema.TaggedError<CrossAccountMove>()(
  "CrossAccountMove",
  {
    destinationAccountId: Schema.String,
    sourceAccountId: Schema.String,
  }
) {}
