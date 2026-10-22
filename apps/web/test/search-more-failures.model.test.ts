import { CalendarRef } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import { SearchNotice } from "../src/client/search/model.js";
import { searchTask } from "../src/client/search/source.js";
import { refreshSearch } from "../src/client/search/update.js";
import { searchCalendarFailureNotices } from "../src/layout/search-results.js";
import { searchResponse } from "./search-fixture.js";
import { partiallyFailedSearchPair } from "./search-more-fixture.js";

it.prop(
  "continuation failure provenance survives unrelated successful pages until its own explicit retry succeeds",
  { advances: Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 0 })) },
  ({ advances }) => {
    let model = partiallyFailedSearchPair();
    const initial = model;

    const ref = Schema.decodeUnknownSync(CalendarRef)(
      model.search.continuationFailures[0]
    );

    expect(model.search.continuationFailures).toEqual([ref]);
    const earlier = Option.getOrThrow(model.search.response).results;
    expect(earlier).toHaveLength(2);

    for (let index = 0; index < advances; index += 1) {
      ({ model } = update(model, Message.SearchMore()));
      const task = Option.getOrThrow(searchTask(model));
      const pages = task.request.continuation?.pages ?? [];
      expect(pages).toHaveLength(1);
      expect(
        pages.some(
          (page) =>
            page.accountId === ref.accountId &&
            page.calendarId === ref.calendarId
        )
      ).toBe(false);
      expect(model.search.continuationFailures).toEqual([ref]);

      const response = {
        ...Option.getOrThrow(model.search.response),
        failures: [],
        pageInfo: pages.map((page) => ({
          accountId: page.accountId,
          calendarId: page.calendarId,
          forwardHasMore: true,
          forwardNextPageToken: `other-page-${index + 4}`,
        })),
        results: [],
      };

      ({ model } = update(
        model,
        Message.ReceivedSearch({
          notice: SearchNotice.cases.Ready.make({ response, task }),
        })
      ));
      expect(model.search.continuationFailures).toEqual([ref]);
      expect(Option.getOrThrow(model.search.response).results).toEqual(earlier);

      const notices = searchCalendarFailureNotices(
        Option.getOrThrow(model.search.response),
        model
      );

      expect(notices.map((notice) => notice.continuation)).toEqual([true]);
      expect(notices[0]?.line).toBe(
        "Couldn't load more from Work (owner@example.test)."
      );
    }

    const retry = update(model, Message.SearchRetryCalendar(ref)).model;
    const task = Option.getOrThrow(searchTask(retry));
    expect(task.request.continuation?.pages).toHaveLength(1);
    expect(task.request.continuation?.pages[0]).toMatchObject({
      ...ref,
      pageToken: "provider-page-2",
    });

    const response = {
      ...Option.getOrThrow(retry.search.response),
      failures: [],
      pageInfo: [{ ...ref, forwardHasMore: false }],
      results: [],
    };

    const received = update(
      retry,
      Message.ReceivedSearch({
        notice: SearchNotice.cases.Ready.make({ response, task }),
      })
    ).model;

    expect(received.search.continuationFailures).toEqual([]);
    expect(Option.getOrThrow(received.search.response).failures).toEqual([]);
    expect(Option.getOrThrow(received.search.response).results).toEqual(
      earlier
    );
    expect(initial.search.continuationFailures).toEqual([ref]);
  }
);

it("a fresh initial response resets continuation provenance even when the same calendar fails again", () => {
  const prior = partiallyFailedSearchPair();
  const refreshed = refreshSearch(prior);
  const task = Option.getOrThrow(searchTask(refreshed));
  expect(task.request.continuation).toBeUndefined();

  const response = {
    ...searchResponse([]),
    failures: Option.getOrThrow(prior.search.response).failures,
    pageInfo: [],
  };

  const current = update(
    refreshed,
    Message.ReceivedSearch({
      notice: SearchNotice.cases.Ready.make({ response, task }),
    })
  ).model;

  expect(current.search.continuationFailures).toEqual([]);

  const notices = searchCalendarFailureNotices(
    Option.getOrThrow(current.search.response),
    current
  );

  expect(notices.map((notice) => notice.continuation)).toEqual([false]);
  expect(notices[0]?.line).toBe("Couldn't search Work (owner@example.test).");
});
