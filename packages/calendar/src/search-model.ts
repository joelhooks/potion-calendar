import { Schema } from "effect";

import { CalendarReadFailure } from "./calendar-read-failure.js";
import { Calendar, CalendarEvent, CalendarRef, Range } from "./model.js";

export const SearchEventsInput = Schema.Struct({
  calendars: Schema.Array(Calendar),
  query: Schema.String,
  timeZone: Schema.NonEmptyString,
  weekStartsOn: Schema.Literals([0, 1, 2, 3, 4, 5, 6]),
});

export const SearchEventResult = Schema.Struct({
  calendar: Calendar,
  endMillis: Schema.Finite,
  event: CalendarEvent,
  startMillis: Schema.Finite,
});

export const SearchWindow = Schema.Struct({
  boundary: Range.fields.start,
  endExclusive: Range.fields.end,
});

export const SearchEventsOutput = Schema.Struct({
  failures: Schema.Array(CalendarReadFailure),
  pageInfo: Schema.Array(
    Schema.Struct({
      ...CalendarRef.fields,
      forwardHasMore: Schema.Boolean,
      olderHasMore: Schema.Boolean,
    })
  ),
  results: Schema.Array(SearchEventResult),
  window: SearchWindow,
});

export type SearchEventsInputValue = typeof SearchEventsInput.Type;

export type SearchEventsOutputValue = typeof SearchEventsOutput.Type;

export type SearchEventResultValue = typeof SearchEventResult.Type;
