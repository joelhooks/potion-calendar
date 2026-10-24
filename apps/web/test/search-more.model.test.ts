import {
  CalendarReadFailure,
  Provider,
  SearchPageTarget,
} from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Match, Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import { SearchNotice, SearchProblem } from "../src/client/search/model.js";
import { forwardSearchExhausted } from "../src/client/search/paging.js";
import { searchQueryTask, searchTask } from "../src/client/search/source.js";
import { refreshSearch } from "../src/client/search/update.js";
import { SearchRoute } from "../src/layout/route.js";
import { outsideSearchEvent, searchResponse } from "./search-fixture.js";
import { loadedSearch } from "./search-more-fixture.js";

it.prop(
  "repeated load-more notices dispatch one page without restarting the query-scoped subscriptions",
  [Schema.Array(Schema.Literals(["request"]))],
  ([triggers]) => {
    const initial = loadedSearch();
    let model = initial;
    let dispatched = 0;

    for (const _trigger of triggers) {
      const next = update(model, Message.SearchMore());
      dispatched +=
        next.commands?.filter(
          (command) => command.name === "DispatchSearchPage"
        ).length ?? 0;
      ({ model } = next);
      expect(model.search.phase).toBe("LoadingMore");
      expect(model.search.revision).toBe(initial.search.revision);
      expect(searchQueryTask(model)).toEqual(searchQueryTask(initial));
      expect(model.search.response).toEqual(initial.search.response);
      const task = Option.getOrThrow(searchTask(model));
      expect(task.request.continuation?.pages).toEqual([
        SearchPageTarget.cases.Forward.make({
          accountId: outsideSearchEvent.accountId,
          calendarId: outsideSearchEvent.calendarId,
          pageToken: "provider-page-2",
        }),
      ]);
    }

    expect(dispatched).toBe(triggers.length > 0 ? 1 : 0);
    expect(model.search.revision).toBe(initial.search.revision);
  }
);

it.prop(
  "completed forward pages retain earlier ids, keep the first same-id copy, preserve ordering and clear exhausted tokens",
  [Schema.Int],
  ([serial]) => {
    const initial = loadedSearch();
    const started = update(initial, Message.SearchMore()).model;
    const task = Option.getOrThrow(searchTask(started));
    const newId = `new-page-event-${serial}`;

    const page = searchResponse([
      {
        ...outsideSearchEvent,
        end: { dateTime: "2026-11-19T10:00:00-08:00" },
        eventId: newId,
        start: { dateTime: "2026-11-19T09:00:00-08:00" },
        title: "Second page",
      },
      {
        ...outsideSearchEvent,
        title: "Later duplicate must not replace the first copy",
      },
    ]);

    const response = {
      ...page,
      pageInfo: [
        {
          accountId: outsideSearchEvent.accountId,
          calendarId: outsideSearchEvent.calendarId,
          forwardHasMore: false,
        },
      ],
      window: Option.getOrThrow(initial.search.response).window,
    };

    const received = update(
      started,
      Message.ReceivedSearch({
        notice: SearchNotice.cases.Ready.make({ response, task }),
      })
    ).model;

    const merged = Option.getOrThrow(received.search.response);
    expect(merged.results.map((row) => row.event.eventId)).toEqual([
      outsideSearchEvent.eventId,
      newId,
    ]);
    expect(merged.results[0]?.event.title).toBe(outsideSearchEvent.title);
    expect(new Set(merged.results.map((row) => row.event.eventId)).size).toBe(
      merged.results.length
    );
    expect(merged.pageInfo[0]?.forwardNextPageToken).toBeUndefined();
    expect(merged.pageInfo[0]?.olderHasMore).toBe(true);
    expect(forwardSearchExhausted(merged)).toBe(true);
    expect(update(received, Message.SearchMore()).model.search).toEqual(
      received.search
    );
  }
);

it.prop(
  "partial failures retain earlier rows and the failed calendar token, and an explicit calendar retry reuses that token",
  [Schema.Int],
  ([status]) => {
    const initial = loadedSearch();
    const started = update(initial, Message.SearchMore()).model;
    const task = Option.getOrThrow(searchTask(started));
    const before = Option.getOrThrow(initial.search.response);

    const response = {
      ...before,
      failures: [
        new CalendarReadFailure({
          accountId: outsideSearchEvent.accountId,
          calendarId: outsideSearchEvent.calendarId,
          cause: new Provider({
            message: "Fake page failure",
            operation: "events.list",
            status,
          }),
        }),
      ],
      pageInfo: [],
      results: [],
    };

    const failed = update(
      started,
      Message.ReceivedSearch({
        notice: SearchNotice.cases.Ready.make({ response, task }),
      })
    ).model;

    expect(Option.getOrThrow(failed.search.response).results).toEqual(
      before.results
    );
    expect(Option.getOrThrow(failed.search.response).pageInfo).toEqual(
      before.pageInfo
    );
    expect(
      forwardSearchExhausted(Option.getOrThrow(failed.search.response))
    ).toBe(false);
    expect(update(failed, Message.SearchMore()).model.search).toEqual(
      failed.search
    );

    const retry = update(
      failed,
      Message.SearchRetryCalendar({
        accountId: outsideSearchEvent.accountId,
        calendarId: outsideSearchEvent.calendarId,
      })
    ).model;

    expect(retry.search.phase).toBe("LoadingMore");
    expect(
      Option.getOrThrow(searchTask(retry)).request.continuation?.pages
    ).toEqual(task.request.continuation?.pages);
    expect(retry.search.response).toEqual(failed.search.response);
  }
);

it.prop(
  "transport failure retains pages and only explicit retry restarts the outstanding cursor batch",
  [Schema.NonEmptyString],
  ([message]) => {
    const initial = loadedSearch();
    const started = update(initial, Message.SearchMore()).model;
    const task = Option.getOrThrow(searchTask(started));

    const failed = update(
      started,
      Message.ReceivedSearch({
        notice: SearchNotice.cases.Failed.make({
          problem: SearchProblem.cases.Transport.make({ message }),
          task,
        }),
      })
    ).model;

    expect(failed.search.phase).toBe("MoreFailed");
    expect(failed.search.response).toEqual(initial.search.response);
    expect(update(failed, Message.SearchMore()).model.search).toEqual(
      failed.search
    );
    const retry = update(failed, Message.SearchRetryMore()).model;
    expect(retry.search.phase).toBe("LoadingMore");
    expect(Option.getOrThrow(searchTask(retry)).request.continuation).toEqual(
      task.request.continuation
    );
    expect(retry.search.revision).toBe(failed.search.revision);
  }
);

it.prop(
  "a new query clears continuation identity and rejects a prior page completion without losing the pending query",
  [Schema.NonEmptyString],
  ([suffix]) => {
    const initial = loadedSearch();
    const started = update(initial, Message.SearchMore()).model;
    const task = Option.getOrThrow(searchTask(started));
    const text = `different query ${suffix}`;
    const changed = update(started, Message.SearchInput({ text })).model;
    expect(changed.search.continuation).toBeUndefined();

    const late = update(
      changed,
      Message.ReceivedSearch({
        notice: SearchNotice.cases.Ready.make({
          response: searchResponse([]),
          task,
        }),
      })
    ).model;

    expect(late.search).toEqual(changed.search);
    expect(late.search.text).toBe(text);
    expect(late.route).toEqual(
      SearchRoute.make({ q: initial.search.urlQuery })
    );
  }
);

it.prop(
  "continuation completions cannot cross person, zone, week-start or revision boundaries",
  { mismatch: Schema.Literals(["person", "zone", "week", "revision"]) },
  ({ mismatch }) => {
    const started = update(loadedSearch(), Message.SearchMore()).model;
    const task = Option.getOrThrow(searchTask(started));

    const stale = Match.value(mismatch).pipe(
      Match.when("person", () => ({ ...task, personId: "different-person" })),
      Match.when("zone", () => ({
        ...task,
        request: { ...task.request, timeZone: "UTC" },
      })),
      Match.when("week", () => ({
        ...task,
        request: { ...task.request, weekStartsOn: 1 as const },
      })),
      Match.when("revision", () => ({ ...task, revision: task.revision - 1 })),
      Match.exhaustive
    );

    const result = update(
      started,
      Message.ReceivedSearch({
        notice: SearchNotice.cases.Ready.make({
          response: searchResponse([]),
          task: stale,
        }),
      })
    );

    expect(result.model).toBe(started);
    expect(result.commands ?? []).toHaveLength(0);
  }
);

it.prop(
  "a response-window mismatch preserves all pages and requires a fresh search instead of accepting rows or cursors",
  { field: Schema.Literals(["boundary", "endExclusive"]) },
  ({ field }) => {
    const initial = loadedSearch();
    const started = update(initial, Message.SearchMore()).model;
    const task = Option.getOrThrow(searchTask(started));
    const previous = Option.getOrThrow(initial.search.response);

    const response = {
      ...searchResponse([]),
      window: { ...previous.window, [field]: "2035-01-01T00:00:00Z" },
    };

    const result = update(
      started,
      Message.ReceivedSearch({
        notice: SearchNotice.cases.Ready.make({ response, task }),
      })
    );

    expect(result.model.search.phase).toBe("MoreFailed");
    expect(result.model.search.response).toEqual(initial.search.response);
    expect(result.commands ?? []).toHaveLength(0);
    const refreshed = refreshSearch(result.model);
    expect(refreshed.search.continuation).toBeUndefined();
    expect(
      Option.getOrThrow(searchTask(refreshed)).request.continuation
    ).toBeUndefined();
    expect(refreshed.search.revision).toBe(started.search.revision + 1);
  }
);

it("an explicit refresh replaces the old page set and cursors with a new initial response", () => {
  const initial = loadedSearch();
  const started = update(initial, Message.SearchMore()).model;
  const oldTask = Option.getOrThrow(searchTask(started));
  const refreshed = refreshSearch(started);
  const currentTask = Option.getOrThrow(searchTask(refreshed));
  expect(currentTask.request.continuation).toBeUndefined();
  expect(refreshed.search.response).toEqual(initial.search.response);
  const response = { ...searchResponse([]), pageInfo: [] };

  const received = update(
    refreshed,
    Message.ReceivedSearch({
      notice: SearchNotice.cases.Ready.make({ response, task: currentTask }),
    })
  ).model;

  expect(Option.getOrThrow(received.search.response)).toEqual(response);
  expect(searchTask(received)).toEqual(Option.some(currentTask));

  const late = update(
    received,
    Message.ReceivedSearch({
      notice: SearchNotice.cases.Ready.make({
        response: searchResponse(),
        task: oldTask,
      }),
    })
  );

  expect(late.model).toBe(received);
});
