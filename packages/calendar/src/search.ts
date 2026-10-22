import { DateTime, Effect, Option, Result } from "effect";

import { CalendarReadFailure } from "./calendar-read-failure.js";
import { NotFound, Provider } from "./errors.js";
import { GoogleCalendarClient } from "./google.js";
import type { ListPageInput } from "./google.js";
import type { CalendarValue } from "./model.js";
import { calendarReadConcurrency } from "./read-concurrency.js";
import { SearchPageTarget } from "./search-model.js";
import type {
  SearchEventsInputValue,
  SearchEventsOutputValue,
  SearchEventResultValue,
  SearchWindow,
} from "./search-model.js";
import { orderSearchResults, searchEventResult } from "./search-results.js";

const searchWindow = Effect.fn("searchWindow")(function* searchWindow(
  input: SearchEventsInputValue
) {
  const now = yield* DateTime.now;
  const local = DateTime.makeZoned(now, { timeZone: input.timeZone });

  if (Option.isNone(local)) {
    return yield* new Provider({
      message: "Use a valid named primary time zone for event search",
      operation: "searchEvents",
      status: 0,
    });
  }

  if (input.continuation !== undefined) {
    return input.continuation.window;
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

  return {
    boundary: DateTime.formatIso(boundary),
    endExclusive: DateTime.formatIso(endExclusive),
  };
});

const searchCalendarPage = Effect.fn("searchCalendarPage")(
  function* searchCalendarPage(
    target: typeof SearchPageTarget.Type,
    calendars: readonly CalendarValue[],
    input: SearchEventsInputValue,
    window: typeof SearchWindow.Type
  ) {
    const calendar = calendars.find(
      (item) =>
        item.accountId === target.accountId &&
        item.calendarId === target.calendarId
    );

    if (calendar === undefined || calendar.accessRole === "freeBusyReader") {
      return yield* new NotFound({ operation: "searchEvents" });
    }

    const google = yield* GoogleCalendarClient;

    const common = {
      orderBy: "startTime",
      q: input.query.trim(),
      ref: calendar,
      singleEvents: true,
    } satisfies ListPageInput;

    const forward = yield* google.listPage({
      ...common,
      maxResults: 100,
      pageToken: SearchPageTarget.guards.Forward(target)
        ? target.pageToken
        : undefined,
      timeMax: window.endExclusive,
      timeMin: window.boundary,
    });

    const older = SearchPageTarget.guards.Initial(target)
      ? yield* google.listPage({
          ...common,
          maxResults: 2500,
          timeMax: window.boundary,
        })
      : undefined;

    const token = forward.nextPageToken;
    const hasMore = token !== undefined && token.length > 0;

    return {
      pageInfo: {
        accountId: calendar.accountId,
        calendarId: calendar.calendarId,
        forwardHasMore: hasMore,
        forwardNextPageToken: hasMore ? token : undefined,
        olderHasMore:
          older === undefined
            ? undefined
            : (older.nextPageToken?.length ?? 0) > 0,
      },
      results: [...forward.events, ...(older?.events ?? [])].flatMap((event) =>
        Option.toArray(searchEventResult(calendar, event, input.timeZone))
      ),
    };
  }
);

export const searchCalendarEvents = Effect.fn("searchCalendarEvents")(
  function* searchCalendarEvents(
    input: SearchEventsInputValue
  ): Effect.fn.Return<SearchEventsOutputValue, Provider, GoogleCalendarClient> {
    const window = yield* searchWindow(input);

    if (input.query.trim() === "") {
      return { failures: [], pageInfo: [], results: [], window };
    }

    const targets =
      input.continuation?.pages ??
      input.calendars
        .filter((calendar) => calendar.accessRole !== "freeBusyReader")
        .map((calendar) =>
          SearchPageTarget.cases.Initial.make({
            accountId: calendar.accountId,
            calendarId: calendar.calendarId,
          })
        );

    const seen = new Set<string>();

    const unique = targets.filter((target) => {
      const key = JSON.stringify([target.accountId, target.calendarId]);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    });

    const outcomes = yield* Effect.forEach(
      unique,
      (target) =>
        searchCalendarPage(target, input.calendars, input, window).pipe(
          Effect.mapError(
            (cause) =>
              new CalendarReadFailure({
                accountId: target.accountId,
                calendarId: target.calendarId,
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
