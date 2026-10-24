import { CalendarReadFailure, Provider } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import { SearchPageNotice } from "../src/client/search/page-model.js";
import { searchQueryTask } from "../src/client/search/source.js";
import { searchCalendarFailureNotices } from "../src/layout/search-results.js";
import {
  searchHistoryFixture,
  searchHistoryScenes,
} from "./search-history-fixture.js";

it.prop(
  "a success in either paging direction preserves the other direction's failure, retry cursor and footer provenance",
  [Schema.Literals(["forward", "reverse"]), Schema.Boolean],
  ([failedDirection, failureFirst]) => {
    const [scene] = searchHistoryScenes;
    const fixture = searchHistoryFixture(scene);
    const initialResponse = Option.getOrThrow(fixture.before.search.response);

    const initial = {
      ...fixture.before,
      search: {
        ...fixture.before.search,
        response: Option.some({
          ...initialResponse,
          pageInfo: initialResponse.pageInfo.map((page) => ({
            ...page,
            forwardHasMore: true,
            forwardNextPageToken: "retained-forward-token",
          })),
        }),
      },
    };

    const forward = update(initial, Message.SearchMore()).model;
    let { model } = update(forward, Message.SearchOlder());
    const task = Option.getOrThrow(searchQueryTask(model));

    const pages = {
      forward: {
        continuation: Option.getOrThrow(
          Option.fromUndefinedOr(model.search.continuation)
        ),
        task,
      },
      reverse: {
        continuation: Option.getOrThrow(
          Option.fromUndefinedOr(model.search.reverseContinuation)
        ),
        task,
      },
    };

    const successDirection =
      failedDirection === "forward" ? "reverse" : "forward";

    const failure = SearchPageNotice.cases.Ready.make({
      direction: failedDirection,
      page: pages[failedDirection],
      response: {
        ...initialResponse,
        failures: [
          new CalendarReadFailure({
            accountId: "work",
            calendarId: "primary",
            cause: new Provider({
              message: "Try this direction again",
              operation: "searchEvents",
              status: 503,
            }),
          }),
        ],
        pageInfo: [],
        results: [],
      },
    });

    const success = SearchPageNotice.cases.Ready.make({
      direction: successDirection,
      page: pages[successDirection],
      response: {
        ...initialResponse,
        failures: [],
        pageInfo: [
          {
            accountId: "work",
            calendarId: "primary",
            forwardHasMore: false,
            olderCursor:
              successDirection === "reverse"
                ? { windowEnd: "2024-09-20T07:00:00Z" }
                : undefined,
            olderHasMore: successDirection === "reverse" ? true : undefined,
          },
        ],
        results: [],
      },
    });

    for (const notice of failureFirst
      ? [failure, success]
      : [success, failure]) {
      ({ model } = update(
        model,
        Message.ApplySearchPage({ anchor: Option.none(), notice })
      ));
    }

    const response = Option.getOrThrow(model.search.response);
    expect(response.failures.map((item) => item.calendarId)).toEqual([
      "primary",
    ]);
    const notices = searchCalendarFailureNotices(response, model);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.continuation).toBe(true);
    expect(notices[0]?.reverse).toBe(failedDirection === "reverse");

    if (failedDirection === "forward") {
      expect(response.pageInfo[0]?.forwardNextPageToken).toBe(
        "retained-forward-token"
      );
      expect(response.pageInfo[0]?.olderCursor).toEqual({
        windowEnd: "2024-09-20T07:00:00Z",
      });

      const retry = update(
        model,
        Message.SearchRetryCalendar({
          accountId: "work",
          calendarId: "primary",
        })
      ).model;

      expect(retry.search.continuation?.pages).toEqual(
        pages.forward.continuation.pages
      );
    } else {
      expect(response.pageInfo[0]?.forwardNextPageToken).toBeUndefined();
      expect(response.pageInfo[0]?.olderCursor).toEqual({
        windowEnd: "2025-09-20T07:00:00Z",
      });

      const retry = update(
        model,
        Message.SearchRetryOlderCalendar({
          accountId: "work",
          calendarId: "primary",
        })
      ).model;

      expect(retry.search.reverseContinuation?.pages).toEqual(
        pages.reverse.continuation.pages
      );
    }
  }
);
