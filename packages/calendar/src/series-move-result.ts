import { Match, Schema } from "effect";

import { CalendarFailure } from "./errors.js";
import type { CalendarFailureValue } from "./errors.js";
import { SeriesMoveRetimePartial } from "./series-move-partial.js";
import { SeriesMoveRetimeRefused } from "./series-move-refused.js";
import { SeriesMoveRetimeUncertain } from "./series-move-uncertain.js";

export { SeriesMoveRetimePartial } from "./series-move-partial.js";

export { SeriesMoveRetimeRefused } from "./series-move-refused.js";

export { SeriesMoveRetimeUncertain } from "./series-move-uncertain.js";

export const SeriesMoveRetimeFailure = Schema.Union([
  CalendarFailure,
  SeriesMoveRetimeRefused,
  SeriesMoveRetimeUncertain,
  SeriesMoveRetimePartial,
]);

export type SeriesMoveRetimeFailureValue = typeof SeriesMoveRetimeFailure.Type;

export const uncertainCalendarWrite = Match.type<CalendarFailureValue>().pipe(
  Match.tag(
    "Provider",
    (failure) =>
      failure.status < 400 || failure.status >= 500 || failure.status === 408
  ),
  Match.orElse(() => false)
);
