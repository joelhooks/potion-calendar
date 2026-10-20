import { Schema } from "effect";

import { CalendarFailure } from "./errors.js";
import { CalendarEvent, EventTime } from "./model.js";

export class SeriesMoveRetimePartial extends Schema.TaggedError<SeriesMoveRetimePartial>()(
  "SeriesMoveRetimePartial",
  {
    cause: CalendarFailure,
    changes: Schema.Struct({ end: EventTime, start: EventTime }),
    completedStep: Schema.Literals(["move"]),
    movedEvent: CalendarEvent,
    retimeOutcome: Schema.Literals(["rejected", "unknown"]),
  }
) {}
