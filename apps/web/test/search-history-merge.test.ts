import { CalendarReadFailure, Provider } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Option } from "effect";

import { Message, update } from "../src/client/app.js";
import { SearchPageNotice } from "../src/client/search/page-model.js";
import { searchQueryTask } from "../src/client/search/source.js";
import { loadedSearch } from "./search-more-fixture.js";

it("reverse partial failure retries only failed calendars and retains the successful calendar's advanced cursor", () => {
  const base = loadedSearch();
  const response = Option.getOrThrow(base.search.response);

  const initial = {
    ...base,
    search: {
      ...base.search,
      response: Option.some({
        ...response,
        pageInfo: [
          {
            accountId: "work",
            calendarId: "primary",
            forwardHasMore: true,
            forwardNextPageToken: "keep-forward",
            olderCursor: { windowEnd: "2025-09-20T07:00:00Z" },
            olderHasMore: true,
          },
          {
            accountId: "work",
            calendarId: "second",
            forwardHasMore: false,
            olderCursor: { windowEnd: "2025-09-20T07:00:00Z" },
            olderHasMore: true,
          },
        ],
      }),
    },
  };

  const pending = update(initial, Message.SearchOlder()).model;
  const task = Option.getOrThrow(searchQueryTask(pending));

  const continuation = Option.getOrThrow(
    Option.fromUndefinedOr(pending.search.reverseContinuation)
  );

  expect(continuation.pages).toHaveLength(2);

  const notice = SearchPageNotice.cases.Ready.make({
    direction: "reverse",
    page: { continuation, task },
    response: {
      ...response,
      failures: [
        new CalendarReadFailure({
          accountId: "work",
          calendarId: "primary",
          cause: new Provider({
            message: "Temporary history read refusal",
            operation: "searchEvents",
            status: 503,
          }),
        }),
      ],
      pageInfo: [
        {
          accountId: "work",
          calendarId: "second",
          forwardHasMore: false,
          olderCursor: { windowEnd: "2024-09-20T07:00:00Z" },
          olderHasMore: true,
        },
      ],
      results: [],
    },
  });

  const settled = update(
    pending,
    Message.ApplySearchPage({ anchor: Option.none(), notice })
  ).model;

  const result = Option.getOrThrow(settled.search.response);
  expect(
    result.pageInfo.find((page) => page.calendarId === "primary")
      ?.forwardNextPageToken
  ).toBe("keep-forward");
  expect(
    result.pageInfo.find((page) => page.calendarId === "second")?.olderCursor
  ).toEqual({ windowEnd: "2024-09-20T07:00:00Z" });

  const retry = update(settled, Message.SearchRetryOlder()).model;

  expect(
    retry.search.reverseContinuation?.pages.map((page) => page.calendarId)
  ).toEqual(["primary"]);

  const unrelated = update(settled, Message.SearchOlder()).model;

  const laterContinuation = Option.getOrThrow(
    Option.fromUndefinedOr(unrelated.search.reverseContinuation)
  );

  expect(laterContinuation.pages.map((page) => page.calendarId)).toEqual([
    "second",
  ]);

  const laterNotice = SearchPageNotice.cases.Ready.make({
    direction: "reverse",
    page: { continuation: laterContinuation, task },
    response: {
      ...notice.response,
      failures: [],
      pageInfo: [
        {
          accountId: "work",
          calendarId: "second",
          forwardHasMore: false,
          olderCursor: { windowEnd: "2023-09-21T07:00:00Z" },
          olderHasMore: true,
        },
      ],
    },
  });

  const afterUnrelated = update(
    unrelated,
    Message.ApplySearchPage({ anchor: Option.none(), notice: laterNotice })
  ).model;

  expect(
    Option.getOrThrow(afterUnrelated.search.response).failures.map(
      (failure) => failure.calendarId
    )
  ).toEqual(["primary"]);

  const retainedRetry = update(
    afterUnrelated,
    Message.SearchRetryOlderCalendar({
      accountId: "work",
      calendarId: "primary",
    })
  ).model;

  expect(retainedRetry.search.reverseContinuation?.pages).toEqual(
    continuation.pages.filter((page) => page.calendarId === "primary")
  );
});
