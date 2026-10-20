import { Schema } from "effect";

import { EventRef } from "./model.js";

export class SeriesMoveRetimeRefused extends Schema.TaggedError<SeriesMoveRetimeRefused>()(
  "SeriesMoveRetimeRefused",
  {
    ...EventRef.fields,
    reason: Schema.Literals([
      "notRecurringInstance",
      "invalidMaster",
      "dateChanged",
      "timedEventRequired",
      "masterTimeZoneRequired",
      "invalidTime",
      "invalidDuration",
      "unrepresentableTime",
      "durationTransition",
      "sameCalendar",
    ]),
  }
) {}
