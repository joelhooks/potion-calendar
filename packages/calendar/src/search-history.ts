import { DateTime, Effect, Option } from "effect";

import { Provider } from "./errors.js";
import { GoogleCalendarClient } from "./google.js";
import type { ListPageInput } from "./google.js";
import type { CalendarEventValue } from "./model.js";
import type { SearchOlderCursor, SearchWindow } from "./search-model.js";

export const searchHistoryPage = Effect.fn("searchHistoryPage")(
  function* searchHistoryPage(
    common: ListPageInput,
    window: typeof SearchWindow.Type,
    cursor: typeof SearchOlderCursor.Type,
    timeZone: string,
    initial: boolean
  ) {
    const google = yield* GoogleCalendarClient;
    const horizon = DateTime.makeZoned(window.historyStart, { timeZone });
    const boundary = DateTime.makeZoned(window.boundary, { timeZone });
    let current: typeof SearchOlderCursor.Type | undefined = cursor;
    const events: CalendarEventValue[] = [];

    for (
      let emptyWindows = 0;
      emptyWindows < (initial ? 1 : 3);
      emptyWindows += 1
    ) {
      const end = DateTime.makeZoned(current.windowEnd, { timeZone });

      if (
        Option.isNone(end) ||
        Option.isNone(horizon) ||
        Option.isNone(boundary) ||
        DateTime.toEpochMillis(end.value) >
          DateTime.toEpochMillis(boundary.value) ||
        DateTime.toEpochMillis(end.value) <
          DateTime.toEpochMillis(horizon.value)
      ) {
        return yield* new Provider({
          message: "Use a cursor inside the original search history window",
          operation: "searchEvents",
          status: 0,
        });
      }

      if (
        DateTime.toEpochMillis(end.value) ===
        DateTime.toEpochMillis(horizon.value)
      ) {
        return { cursor: undefined, events };
      }

      const start = DateTime.makeUnsafe(
        Math.max(
          DateTime.toEpochMillis(horizon.value),
          DateTime.toEpochMillis(DateTime.subtract(end.value, { days: 365 }))
        )
      );

      const startIso = DateTime.formatIso(start);

      const page = yield* google.listPage({
        ...common,
        maxResults: initial ? 2500 : 500,
        pageToken: current.pageToken,
        timeMax: current.windowEnd,
        timeMin: startIso,
      });

      events.push(...page.events);

      if (page.nextPageToken !== undefined && page.nextPageToken.length > 0) {
        return {
          cursor: {
            pageToken: page.nextPageToken,
            windowEnd: current.windowEnd,
          },
          events,
        };
      }

      current =
        DateTime.toEpochMillis(start) <= DateTime.toEpochMillis(horizon.value)
          ? undefined
          : { windowEnd: startIso };

      if (current === undefined || page.events.length > 0) {
        return { cursor: current, events };
      }
    }

    return { cursor: current, events };
  }
);
