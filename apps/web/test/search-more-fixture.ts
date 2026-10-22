import { CalendarReadFailure, Provider } from "@calendar/calendar/contracts";
import { Option } from "effect";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { SearchNotice } from "../src/client/search/model.js";
import { searchScope, searchTask } from "../src/client/search/source.js";
import {
  outsideSearchEvent,
  searchResponse,
  searchResultsFixture,
} from "./search-fixture.js";

export const searchMoreScenarios = [
  "loading-more",
  "more-available",
  "exhausted",
  "partial-failure",
] as const;

export type SearchMoreScenario = (typeof searchMoreScenarios)[number];

export const loadedSearch = (): AppModel => {
  const base = searchResultsFixture();
  const response = searchResponse([outsideSearchEvent]);

  return {
    ...base,
    search: {
      ...base.search,
      continuation: undefined,
      response: Option.some({
        ...response,
        pageInfo: [
          {
            accountId: outsideSearchEvent.accountId,
            calendarId: outsideSearchEvent.calendarId,
            forwardHasMore: true,
            forwardNextPageToken: "provider-page-2",
            olderHasMore: true,
          },
        ],
      }),
      responseScope: searchScope(base),
    },
  };
};

export const searchMoreFixture = (
  scenario: SearchMoreScenario,
  theme: "light" | "dark"
): AppModel => {
  const initial = loadedSearch();
  const base = { ...initial, settings: { ...initial.settings, theme } };

  if (scenario === "more-available") {
    return base;
  }

  const pending = update(base, Message.SearchMore()).model;

  if (scenario === "loading-more") {
    return pending;
  }

  const task = Option.getOrThrow(searchTask(pending));
  const first = Option.getOrThrow(base.search.response);
  const failure = scenario === "partial-failure";

  const response = {
    ...first,
    failures: failure
      ? [
          new CalendarReadFailure({
            accountId: outsideSearchEvent.accountId,
            calendarId: outsideSearchEvent.calendarId,
            cause: new Provider({
              message: "Fake fixture page failure",
              operation: "events.list",
              status: 500,
            }),
          }),
        ]
      : [],
    pageInfo: failure
      ? []
      : [
          {
            accountId: outsideSearchEvent.accountId,
            calendarId: outsideSearchEvent.calendarId,
            forwardHasMore: false,
          },
        ],
    results: [],
  };

  return update(
    pending,
    Message.ReceivedSearch({
      notice: SearchNotice.cases.Ready.make({ response, task }),
    })
  ).model;
};

export const partiallyFailedSearchPair = (): AppModel => {
  const initial = loadedSearch();

  const other = initial.calendar.calendars.find(
    (calendar) =>
      calendar.accountId === outsideSearchEvent.accountId &&
      calendar.calendarId !== outsideSearchEvent.calendarId
  );

  if (other === undefined) {
    throw new Error("Missing second search calendar fixture");
  }

  const previous = Option.getOrThrow(initial.search.response);

  const response = searchResponse([
    outsideSearchEvent,
    {
      ...outsideSearchEvent,
      calendarId: other.calendarId,
      eventId: "other-calendar-result",
      title: "Other calendar result",
    },
  ]);

  const base = {
    ...initial,
    search: {
      ...initial.search,
      response: Option.some({
        ...response,
        pageInfo: [
          ...previous.pageInfo,
          {
            accountId: other.accountId,
            calendarId: other.calendarId,
            forwardHasMore: true,
            forwardNextPageToken: "other-page-2",
            olderHasMore: false,
          },
        ],
      }),
    },
  };

  const pending = update(base, Message.SearchMore()).model;
  const task = Option.getOrThrow(searchTask(pending));

  return update(
    pending,
    Message.ReceivedSearch({
      notice: SearchNotice.cases.Ready.make({
        response: {
          ...response,
          failures: [
            new CalendarReadFailure({
              accountId: outsideSearchEvent.accountId,
              calendarId: outsideSearchEvent.calendarId,
              cause: new Provider({
                message: "Fake continuation failure",
                operation: "events.list",
                status: 500,
              }),
            }),
          ],
          pageInfo: [
            {
              accountId: other.accountId,
              calendarId: other.calendarId,
              forwardHasMore: true,
              forwardNextPageToken: "other-page-3",
            },
          ],
          results: [],
          window: previous.window,
        },
        task,
      }),
    })
  ).model;
};
