import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";

import { CalendarService } from "../src/calendar.js";
import { SearchPageTarget } from "../src/search-model.js";
import { response, timedEvent } from "./fake-google.js";
import {
  searchCalendar,
  searchFixture,
  searchInput,
} from "./search-fixture.js";

const searchEpoch = DateTime.toEpochMillis(
  DateTime.makeUnsafe("2026-03-15T17:00:00Z")
);

it.effect.prop(
  "forward search sends each returned opaque token once to its own calendar and keeps the original window after the clock moves",
  { serial: Schema.Int },
  ({ serial }) =>
    Effect.gen(function* forwardPages() {
      yield* TestClock.setTime(searchEpoch);
      const calendars = [searchCalendar("a"), searchCalendar("b")];
      const tokens = { a: `next+a/%=${serial}`, b: `next+b/%=${serial}` };

      const fake = yield* searchFixture((url) => {
        const id = url.pathname.includes("/a/") ? "a" : "b";
        const token = url.searchParams.get("pageToken");

        if (token !== null) {
          return response(200, { items: [timedEvent(`second-${id}`)] });
        }

        return url.searchParams.has("timeMin")
          ? response(200, {
              items: [timedEvent(`first-${id}`)],
              nextPageToken: tokens[id],
            })
          : response(200, { items: [], nextPageToken: `older-${id}` });
      });

      const first = yield* CalendarService.use((calendar) =>
        calendar.searchEvents({ ...searchInput, calendars })
      ).pipe(Effect.provide(fake.layer));

      expect(first.pageInfo.map((page) => page.forwardNextPageToken)).toEqual([
        tokens.a,
        tokens.b,
      ]);

      const pages = first.pageInfo.flatMap((page) =>
        page.forwardNextPageToken === undefined
          ? []
          : [
              SearchPageTarget.cases.Forward.make({
                accountId: page.accountId,
                calendarId: page.calendarId,
                pageToken: page.forwardNextPageToken,
              }),
            ]
      );

      yield* TestClock.setTime(searchEpoch + 35 * 86_400_000);

      const second = yield* CalendarService.use((calendar) =>
        calendar.searchEvents({
          ...searchInput,
          calendars,
          continuation: { pages, window: first.window },
        })
      ).pipe(Effect.provide(fake.layer));

      expect(second.window).toEqual(first.window);
      expect(second.results.map((row) => row.event.eventId)).toEqual([
        "second-a",
        "second-b",
      ]);
      expect(second.pageInfo.map((page) => page.forwardHasMore)).toEqual([
        false,
        false,
      ]);
      expect(
        second.pageInfo.every((page) => page.forwardNextPageToken === undefined)
      ).toBe(true);
      expect(
        second.pageInfo.every((page) => page.olderHasMore === undefined)
      ).toBe(true);
      const requests = yield* Ref.get(fake.requests);
      expect(requests).toHaveLength(6);

      for (const request of requests.slice(4)) {
        const url = new URL(`https://fake.test${request.path}`);
        const id = url.pathname.includes("/a/") ? "a" : "b";
        expect(url.searchParams.get("pageToken")).toBe(tokens[id]);
        expect(url.searchParams.get("maxResults")).toBe("100");
        expect(url.searchParams.get("timeMin")).toBe(first.window.boundary);
        expect(url.searchParams.get("timeMax")).toBe(first.window.endExclusive);
        expect(url.searchParams.get("q")).toBe(searchInput.query);
        expect(url.searchParams.get("singleEvents")).toBe("true");
        expect(url.searchParams.get("orderBy")).toBe("startTime");
      }

      const exhausted = yield* CalendarService.use((calendar) =>
        calendar.searchEvents({
          ...searchInput,
          calendars,
          continuation: { pages: [], window: first.window },
        })
      ).pipe(Effect.provide(fake.layer));

      expect(exhausted.results).toEqual([]);
      expect(yield* Ref.get(fake.requests)).toHaveLength(6);
    })
);

it.effect(
  "a failed forward calendar can retry its same token without reading an exhausted calendar or either older part again",
  () =>
    Effect.gen(function* partialPageRetry() {
      yield* TestClock.setTime(searchEpoch);
      const calendars = [searchCalendar("a"), searchCalendar("b")];
      let phase: "initial" | "partial" | "retry" = "initial";

      const fake = yield* searchFixture((url) => {
        const id = url.pathname.includes("/a/") ? "a" : "b";

        if (!url.searchParams.has("pageToken")) {
          return url.searchParams.has("timeMin")
            ? response(200, {
                items: [timedEvent(`first-${id}`)],
                nextPageToken: `next-${id}`,
              })
            : response(200, { items: [] });
        }

        if (id === "b" && phase === "partial") {
          return response(500, {
            error: { message: "Temporary fake failure" },
          });
        }

        return response(200, { items: [timedEvent(`second-${id}`)] });
      });

      const first = yield* CalendarService.use((calendar) =>
        calendar.searchEvents({ ...searchInput, calendars })
      ).pipe(Effect.provide(fake.layer));

      const pages = first.pageInfo.flatMap((page) =>
        page.forwardNextPageToken === undefined
          ? []
          : [
              SearchPageTarget.cases.Forward.make({
                accountId: page.accountId,
                calendarId: page.calendarId,
                pageToken: page.forwardNextPageToken,
              }),
            ]
      );

      phase = "partial";

      const partial = yield* CalendarService.use((calendar) =>
        calendar.searchEvents({
          ...searchInput,
          calendars,
          continuation: { pages, window: first.window },
        })
      ).pipe(Effect.provide(fake.layer));

      expect(partial.failures.map((failure) => failure.calendarId)).toEqual([
        "b",
      ]);
      expect(partial.results.map((row) => row.event.eventId)).toEqual([
        "second-a",
      ]);
      expect(partial.pageInfo.map((page) => page.calendarId)).toEqual(["a"]);
      phase = "retry";

      const retried = yield* CalendarService.use((calendar) =>
        calendar.searchEvents({
          ...searchInput,
          calendars,
          continuation: {
            pages: pages.filter((page) => page.calendarId === "b"),
            window: first.window,
          },
        })
      ).pipe(Effect.provide(fake.layer));

      expect(retried.failures).toEqual([]);
      expect(retried.results.map((row) => row.event.eventId)).toEqual([
        "second-b",
      ]);
      expect(retried.pageInfo[0]?.forwardHasMore).toBe(false);
      const requests = yield* Ref.get(fake.requests);
      expect(requests).toHaveLength(7);

      const resumed = requests
        .slice(4)
        .map((request) => new URL(`https://fake.test${request.path}`));

      expect(resumed.map((url) => url.searchParams.get("pageToken"))).toEqual([
        "next-a",
        "next-b",
        "next-b",
      ]);
    })
);

it.effect.prop(
  "continuation refs cannot introduce an account or calendar outside the supplied authoritative inventory and repeated refs read only once",
  { duplicate: Schema.Boolean },
  ({ duplicate }) =>
    Effect.gen(function* authorizedContinuation() {
      yield* TestClock.setTime(searchEpoch);
      const fake = yield* searchFixture(() => response(200, { items: [] }));

      const valid = SearchPageTarget.cases.Forward.make({
        accountId: "account",
        calendarId: "calendar",
        pageToken: "opaque-token",
      });

      const unknown = SearchPageTarget.cases.Forward.make({
        accountId: "other-person-account",
        calendarId: "other-calendar",
        pageToken: "untrusted-token",
      });

      const result = yield* CalendarService.use((calendar) =>
        calendar.searchEvents({
          ...searchInput,
          continuation: {
            pages: duplicate ? [valid, valid, unknown] : [valid, unknown],
            window: {
              boundary: "2026-02-09T08:00:00.000Z",
              endExclusive: "2029-02-10T08:00:00.000Z",
            },
          },
        })
      ).pipe(Effect.provide(fake.layer));

      expect(
        result.failures.map((failure) => [
          failure.accountId,
          failure.calendarId,
          failure.cause._tag,
        ])
      ).toEqual([[unknown.accountId, unknown.calendarId, "NotFound"]]);
      expect(result.pageInfo.map((page) => page.calendarId)).toEqual([
        "calendar",
      ]);
      const requests = yield* Ref.get(fake.requests);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.accountId).toBe("account");
      expect(requests[0]?.path).not.toContain("other-calendar");
    })
);
