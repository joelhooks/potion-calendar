import {
  Calendar,
  CalendarEvent,
  CalendarReadFailure,
  Revoked,
} from "@calendar/calendar/contracts";
import { DateTime, Effect, Option, Schema } from "effect";

import type { AppModel } from "../src/client/app.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { SearchRoute } from "../src/layout/route.js";
import { SearchResponse } from "../src/search-contract.js";
import { fixtureEvents } from "./fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";

export const searchCalendar = Schema.decodeUnknownSync(Calendar)(
  keyboardFixture().calendar.calendars.find(
    (calendar) => calendar.calendarId === "primary"
  )
);

export const outsideSearchEvent = CalendarEvent.make({
  attachments: [],
  ...Schema.decodeUnknownSync(CalendarEvent)(fixtureEvents[0]),
  end: { dateTime: "2026-11-18T10:00:00-08:00" },
  eventId: "outside-result",
  iCalUID: "outside-result@example.test",
  start: { dateTime: "2026-11-18T09:00:00-08:00" },
  title: "Planning outside this week",
});

export const searchResponse = (
  events = fixtureEvents.filter((event) =>
    ["a-review", "unanswered", "tentative", "hidden"].includes(event.eventId)
  )
): typeof SearchResponse.Type => {
  const model = keyboardFixture();

  return SearchResponse.make({
    accountFailures: [],
    failures: [],
    pageInfo: [
      {
        accountId: "work",
        calendarId: "primary",
        forwardHasMore: true,
        olderHasMore: false,
      },
    ],
    results: events.map((event) => {
      const calendar = Schema.decodeUnknownSync(Calendar)(
        model.calendar.calendars.find(
          (item) =>
            item.accountId === event.accountId &&
            item.calendarId === event.calendarId
        )
      );

      const start = Schema.decodeUnknownSync(
        Schema.Struct({ dateTime: Schema.String })
      )(event.start).dateTime;

      const end = Schema.decodeUnknownSync(
        Schema.Struct({ dateTime: Schema.String })
      )(event.end).dateTime;

      return {
        calendar,
        endMillis: DateTime.toEpochMillis(DateTime.makeUnsafe(end)),
        event,
        startMillis: DateTime.toEpochMillis(DateTime.makeUnsafe(start)),
      };
    }),
    window: {
      boundary: "2026-09-20T07:00:00Z",
      endExclusive: "2029-09-21T07:00:00Z",
      historyStart: "2016-10-18T07:00:00Z",
    },
  });
};

export const searchResultsFixture = (): AppModel => {
  const model = keyboardFixture();

  return {
    ...model,
    calendar: { ...model.calendar, selected: [] },
    route: SearchRoute.make({ q: "planning" }),
    search: {
      ...model.search,
      phase: "Ready",
      response: Option.some(searchResponse()),
      text: "planning",
      urlQuery: "planning",
    },
  };
};

export const searchEmptyFixture = (): AppModel => {
  const model = searchResultsFixture();

  return {
    ...model,
    search: { ...model.search, response: Option.some(searchResponse([])) },
  };
};

export const searchPartialFailureFixture = (): AppModel => {
  const model = searchResultsFixture();
  const response = searchResponse();

  return {
    ...model,
    search: {
      ...model.search,
      response: Option.some({
        ...response,
        accountFailures: [
          {
            accountId: "revoked",
            failure: new Revoked({ accountId: "revoked" }),
          },
        ],
        failures: [
          new CalendarReadFailure({
            accountId: "work",
            calendarId: "hidden",
            cause: new Revoked({ accountId: "work" }),
          }),
        ],
      }),
    },
  };
};

export const unexpectedSearchClient = CalendarSearchClient.of({
  prefetch: () => Effect.die("Unexpected date prefetch in this fixture"),
  search: () => Effect.die("Unexpected search RPC in this fixture"),
});
