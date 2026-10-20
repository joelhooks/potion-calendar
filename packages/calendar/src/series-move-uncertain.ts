import { Schema } from "effect";

import { CalendarFailure } from "./errors.js";
import { CalendarRef, EventRef } from "./model.js";

export class SeriesMoveRetimeUncertain extends Schema.TaggedError<SeriesMoveRetimeUncertain>()(
  "SeriesMoveRetimeUncertain",
  {
    cause: CalendarFailure,
    destination: CalendarRef,
    iCalUID: Schema.optional(Schema.String),
    source: EventRef,
  }
) {}
