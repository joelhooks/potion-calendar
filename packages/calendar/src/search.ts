import { DateTime, Effect, Option, Result } from "effect";

import { CalendarReadFailure } from "./calendar-read-failure.js";
import { Provider } from "./errors.js";
import { GoogleCalendarClient } from "./google.js";
import type { ListPageInput } from "./google.js";
import { calendarReadConcurrency } from "./read-concurrency.js";
import type {
  SearchEventsInputValue,
  SearchEventsOutputValue,
  SearchEventResultValue,
} from "./search-model.js";
import { orderSearchResults, searchEventResult } from "./search-results.js";

export const searchCalendarEvents = Effect.fn("searchCalendarEvents")(
  function* searchCalendarEvents(
    input: SearchEventsInputValue
  ): Effect.fn.Return<SearchEventsOutputValue, Provider, GoogleCalendarClient> {
    const now = yield* DateTime.now;
    const local = DateTime.makeZoned(now, { timeZone: input.timeZone });

    if (Option.isNone(local)) {
      return yield* new Provider({
        message: "Use a valid named primary time zone for event search",
        operation: "searchEvents",
        status: 0,
      });
    }

    const boundary = DateTime.startOf(
      DateTime.subtract(local.value, { weeks: 4 }),
      "week",
      { weekStartsOn: input.weekStartsOn }
    );

    const endExclusive = DateTime.startOf(
      DateTime.add(DateTime.add(boundary, { years: 3 }), { days: 1 }),
      "day"
    );

    const window = {
      boundary: DateTime.formatIso(boundary),
      endExclusive: DateTime.formatIso(endExclusive),
    };

    const query = input.query.trim();

    if (query === "") {
      return { failures: [], pageInfo: [], results: [], window };
    }

    const google = yield* GoogleCalendarClient;
    const seen = new Set<string>();

    const calendars = input.calendars.filter((calendar) => {
      if (calendar.accessRole === "freeBusyReader") {
        return false;
      }

      const key = JSON.stringify([calendar.accountId, calendar.calendarId]);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    });

    const outcomes = yield* Effect.forEach(
      calendars,
      (calendar) =>
        Effect.gen(function* searchCalendar() {
          const common = {
            orderBy: "startTime",
            q: query,
            ref: calendar,
            singleEvents: true,
          } satisfies ListPageInput;

          const forward = yield* google.listPage({
            ...common,
            maxResults: 100,
            timeMax: window.endExclusive,
            timeMin: window.boundary,
          });

          const older = yield* google.listPage({
            ...common,
            maxResults: 2500,
            timeMax: window.boundary,
          });

          return {
            pageInfo: {
              accountId: calendar.accountId,
              calendarId: calendar.calendarId,
              forwardHasMore: (forward.nextPageToken?.length ?? 0) > 0,
              olderHasMore: (older.nextPageToken?.length ?? 0) > 0,
            },
            results: [...forward.events, ...older.events].flatMap((event) =>
              Option.toArray(searchEventResult(calendar, event, input.timeZone))
            ),
          };
        }).pipe(
          Effect.mapError(
            (cause) =>
              new CalendarReadFailure({
                accountId: calendar.accountId,
                calendarId: calendar.calendarId,
                cause,
              })
          ),
          Effect.result
        ),
      { concurrency: calendarReadConcurrency }
    );

    const failures: CalendarReadFailure[] = [];
    const results: SearchEventResultValue[] = [];
    const pageInfo: SearchEventsOutputValue["pageInfo"][number][] = [];

    for (const outcome of outcomes) {
      if (Result.isFailure(outcome)) {
        failures.push(outcome.failure);
      } else {
        results.push(...outcome.success.results);
        pageInfo.push(outcome.success.pageInfo);
      }
    }

    return { failures, pageInfo, results: orderSearchResults(results), window };
  }
);
