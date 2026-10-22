import { Schema } from "effect";

import { EventRef } from "./model.js";

export const OccurrenceDirection = Schema.Literals(["next", "previous"]);

export const ReadNeighborOccurrenceInput = Schema.Struct({
  ...EventRef.fields,
  direction: OccurrenceDirection,
});

export type ReadNeighborOccurrenceInputValue =
  typeof ReadNeighborOccurrenceInput.Type;
