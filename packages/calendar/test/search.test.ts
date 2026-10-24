import { expect, it } from "@effect/vitest";
import {
  Cause,
  DateTime,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Ref,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";

import { CalendarReadFailure } from "../src/calendar-read-failure.js";
import { CalendarService } from "../src/calendar.js";
import { SearchEventsOutput, searchEventsContract } from "../src/contracts.js";
import { Provider } from "../src/errors.js";
import { GoogleCalendarClient } from "../src/google.js";
import { memoryCalendarStore } from "../src/memory.js";
import { fakeGoogle, response, timedEvent } from "./fake-google.js";
import {
  searchCalendar,
  searchFixture,
  searchInput,
} from "./search-fixture.js";

it.effect.prop(
  "search windows follow local week start and boundary plus three calendar years",
  {
    hasMore: Schema.Boolean,
    scenario: Schema.Literals([
      "monday",
      "sunday",
      "localDate",
      "leap",
      "spring",
    ]),
  },
  ({ hasMore, scenario }) =>
    Effect.gen(function* windowBoundaries() {
      const cases = {
        leap: {
          boundary: "2024-02-29T00:00:00.000Z",
          end: "2027-03-01T00:00:00.000Z",
          now: "2024-03-28T12:00:00Z",
          timeZone: "UTC",
          weekStartsOn: 4,
        },
        localDate: {
          boundary: "2026-01-26T08:00:00.000Z",
          end: "2029-01-27T08:00:00.000Z",
          now: "2026-03-01T04:00:00Z",
          timeZone: "America/Los_Angeles",
          weekStartsOn: 1,
        },
        monday: {
          boundary: "2026-02-09T08:00:00.000Z",
          end: "2029-02-10T08:00:00.000Z",
          now: "2026-03-15T17:00:00Z",
          timeZone: "America/Los_Angeles",
          weekStartsOn: 1,
        },
        spring: {
          boundary: "2026-03-08T08:00:00.000Z",
          end: "2029-03-09T08:00:00.000Z",
          now: "2026-04-05T17:00:00Z",
          timeZone: "America/Los_Angeles",
          weekStartsOn: 0,
        },
        sunday: {
          boundary: "2026-02-15T08:00:00.000Z",
          end: "2029-02-16T08:00:00.000Z",
          now: "2026-03-15T17:00:00Z",
          timeZone: "America/Los_Angeles",
          weekStartsOn: 0,
        },
      } satisfies Record<
        string,
        {
          now: string;
          weekStartsOn: 0 | 1 | 4;
          boundary: string;
          end: string;
          timeZone: string;
        }
      >;

      const expected = cases[scenario];
      yield* TestClock.setTime(
        DateTime.toEpochMillis(DateTime.makeUnsafe(expected.now))
      );

      const fake = yield* searchFixture(() =>
        response(200, {
          items: [],
          nextPageToken: hasMore ? "not-followed" : "",
        })
      );

      const result = yield* CalendarService.use((calendar) =>
        calendar.searchEvents({
          ...searchInput,
          query: "  alpha\t beta  ",
          timeZone: expected.timeZone,
          weekStartsOn: expected.weekStartsOn,
        })
      ).pipe(Effect.provide(fake.layer));

      const requests = yield* Ref.get(fake.requests);
      expect(requests).toHaveLength(2);
      const forward = new URL(`https://fake.test${requests[0]?.path}`);
      const older = new URL(`https://fake.test${requests[1]?.path}`);

      for (const url of [forward, older]) {
        expect(url.pathname).toBe("/calendars/calendar/events");
        expect(url.searchParams.get("q")).toBe("alpha\t beta");
        expect(url.searchParams.get("orderBy")).toBe("startTime");
        expect(url.searchParams.get("singleEvents")).toBe("true");
        expect(url.searchParams.has("pageToken")).toBe(false);
        expect(url.searchParams.has("syncToken")).toBe(false);
      }

      expect(forward.searchParams.get("timeMin")).toBe(expected.boundary);
      expect(forward.searchParams.get("timeMax")).toBe(expected.end);
      expect(forward.searchParams.get("maxResults")).toBe("100");
      expect(older.searchParams.get("timeMin")).toBe(
        DateTime.formatIso(
          DateTime.subtract(
            DateTime.makeZonedUnsafe(expected.boundary, {
              timeZone: expected.timeZone,
            }),
            { days: 365 }
          )
        )
      );
      expect(older.searchParams.get("timeMax")).toBe(expected.boundary);
      expect(older.searchParams.get("maxResults")).toBe("2500");
      expect(result.window).toMatchObject({
        boundary: expected.boundary,
        endExclusive: expected.end,
      });
      expect(result.pageInfo).toMatchObject([
        {
          accountId: "account",
          calendarId: "calendar",
          forwardHasMore: hasMore,
          forwardNextPageToken: hasMore ? "not-followed" : undefined,
          olderHasMore: true,
        },
      ]);
    })
);

it.effect(
  "search includes hidden owned and subscribed calendars but not free-busy-only calendars",
  () =>
    Effect.gen(function* calendarSelection() {
      const hidden = { ...searchCalendar("hidden", "reader"), selected: false };

      const calendars = [
        searchCalendar("owned"),
        hidden,
        searchCalendar("shared", "writer"),
        searchCalendar("free", "freeBusyReader"),
        hidden,
      ];

      const fake = yield* searchFixture((url) =>
        response(200, {
          items: [
            timedEvent(url.pathname, "Provider matched a nonlocal field", {
              organizer: {
                displayName: "Case Name",
                email: "owner@example.test",
              },
            }),
          ],
        })
      );

      const result = yield* CalendarService.use((calendar) =>
        calendar.searchEvents({ ...searchInput, calendars })
      ).pipe(Effect.provide(fake.layer));

      expect(yield* Ref.get(fake.requests)).toHaveLength(6);
      expect(result.pageInfo.map((info) => info.calendarId)).toEqual([
        "owned",
        "hidden",
        "shared",
      ]);
      expect(result.results.map((row) => row.calendar.calendarId)).toEqual([
        "owned",
        "hidden",
        "shared",
      ]);
      expect(
        result.results.every(
          (row) => row.calendar.title === `Calendar ${row.calendar.calendarId}`
        )
      ).toBe(true);
      expect(result.failures).toEqual([]);
      expect(result.results[0]?.event.organizer?.displayName).toBe("Case Name");
    })
);

it.effect(
  "search drops unusable events, deduplicates IDs across calendars and parts, and sorts by start",
  () =>
    Effect.gen(function* mergedResults() {
      const fake = yield* searchFixture((url) =>
        response(200, {
          items: [
            timedEvent("shared", "Cancelled copy", { status: "cancelled" }),
            { end: { date: "2026-03-16" }, id: "shared" },
            timedEvent("shared", "First calendar wins"),
            timedEvent(`${url.pathname}-late`, "Later", {
              end: { dateTime: "2026-03-17T00:30:00-07:00" },
              start: { dateTime: "2026-03-16T23:30:00-07:00" },
            }),
            timedEvent("cancelled", "Cancelled", { status: "cancelled" }),
            { end: { date: "2026-03-16" }, id: "missing-start" },
            { id: "missing-end", start: { date: "2026-03-15" } },
            timedEvent("bad-format", "Malformed", {
              start: { dateTime: "invalid" },
            }),
            timedEvent("bad-date", "Invalid instant", {
              start: { dateTime: "2026-99-99T12:00:00Z" },
            }),
            timedEvent("negative", "Negative duration", {
              end: { dateTime: "2026-03-15T08:00:00-07:00" },
            }),
            timedEvent("", "No ID"),
            {
              end: { date: "2026-03-16" },
              id: "all-day",
              start: { date: "2026-03-15" },
              summary: "All day",
            },
            {
              end: { date: "2026-03-16" },
              id: "bad-all-day",
              start: { date: "not-a-date" },
            },
          ],
        })
      );

      const result = yield* CalendarService.use((calendar) =>
        calendar.searchEvents({
          ...searchInput,
          calendars: [searchCalendar("first"), searchCalendar("second")],
        })
      ).pipe(Effect.provide(fake.layer));

      expect(result.failures).toEqual([]);
      expect(result.results.map((row) => row.event.eventId)).toEqual([
        "all-day",
        "shared",
        "/calendars/first/events-late",
        "/calendars/second/events-late",
      ]);
      expect(
        result.results.find((row) => row.event.eventId === "shared")?.calendar
          .calendarId
      ).toBe("first");
      expect(result.results[0]?.startMillis).toBe(
        DateTime.toEpochMillis(DateTime.makeUnsafe("2026-03-15T07:00:00Z"))
      );
      expect(result.results[0]?.endMillis).toBe(
        DateTime.toEpochMillis(DateTime.makeUnsafe("2026-03-16T07:00:00Z"))
      );
      const codec = Schema.toCodecJson(SearchEventsOutput);
      const encoded = yield* Schema.encodeEffect(codec)(result);
      expect(yield* Schema.decodeEffect(codec)(encoded)).toEqual(result);
      expect(searchEventsContract.annotations.readOnly).toBe(true);
    })
);

it.effect.prop(
  "empty and whitespace-only searches make no provider requests",
  {
    whitespace: Schema.Literals(["", " ", "\t\n\r", "\u00A0\u2003"]),
  },
  ({ whitespace }) =>
    Effect.gen(function* emptyQuery() {
      const fake = yield* searchFixture();

      const result = yield* CalendarService.use((calendar) =>
        calendar.searchEvents({ ...searchInput, query: whitespace })
      ).pipe(Effect.provide(fake.layer));

      expect(result.results).toEqual([]);
      expect(result.failures).toEqual([]);
      expect(result.pageInfo).toEqual([]);
      expect(yield* Ref.get(fake.requests)).toEqual([]);
    })
);

it.effect.prop(
  "failed calendars are reported and neither of their parts leaks into partial results",
  {
    failedIndex: Schema.Literals([0, 1]),
    failedPart: Schema.Literals(["forward", "older"]),
  },
  ({ failedIndex, failedPart }) =>
    Effect.gen(function* partialFailures() {
      const calendars = [
        searchCalendar("first"),
        searchCalendar("second"),
      ] as const;

      const failed = calendars[failedIndex];

      const fake = yield* searchFixture((url) => {
        const part =
          url.searchParams.get("maxResults") === "100" ? "forward" : "older";

        if (
          url.pathname === `/calendars/${failed.calendarId}/events` &&
          part === failedPart
        ) {
          return response(403);
        }

        return response(200, {
          items: [timedEvent(`${url.pathname}-${part}`)],
        });
      });

      const result = yield* CalendarService.use((calendar) =>
        calendar.searchEvents({ ...searchInput, calendars })
      ).pipe(Effect.provide(fake.layer));

      expect(result.failures).toHaveLength(1);
      const [failure] = result.failures;
      expect(failure).toBeInstanceOf(CalendarReadFailure);
      expect(failure?.cause).toBeInstanceOf(Provider);
      expect(failure).toMatchObject({
        accountId: failed.accountId,
        calendarId: failed.calendarId,
        cause: { operation: "GET", status: 403 },
      });
      expect(result.results).toHaveLength(2);
      expect(
        result.results.every(
          (row) => row.calendar.calendarId !== failed.calendarId
        )
      ).toBe(true);
      expect(result.pageInfo.map((info) => info.calendarId)).toEqual([
        calendars[1 - failedIndex]?.calendarId,
      ]);
      const codec = Schema.toCodecJson(SearchEventsOutput);
      expect(
        yield* Schema.decodeEffect(codec)(
          yield* Schema.encodeEffect(codec)(result)
        )
      ).toEqual(result);
    })
);

it.effect.prop(
  "search never exceeds six in-flight requests across both parts",
  {
    count: Schema.Int.check(Schema.isBetween({ maximum: 18, minimum: 7 })),
  },
  ({ count }) =>
    Effect.gen(function* boundedSearch() {
      const calendars = Array.from({ length: count }, (_, index) =>
        searchCalendar(`calendar-${index}`)
      );

      const fake = yield* searchFixture();
      const state = yield* Ref.make({ active: 0, calls: 0, peak: 0 });

      const delayed = Layer.effect(
        GoogleCalendarClient,
        Effect.gen(function* providerPort() {
          const google = yield* GoogleCalendarClient;

          return GoogleCalendarClient.of({
            ...google,
            listPage: () =>
              Effect.acquireUseRelease(
                Ref.update(state, (previous) => ({
                  active: previous.active + 1,
                  calls: previous.calls + 1,
                  peak: Math.max(previous.peak, previous.active + 1),
                })),
                () =>
                  Effect.sleep(100).pipe(
                    Effect.as({
                      events: [],
                      nextPageToken: undefined,
                      nextSyncToken: undefined,
                    })
                  ),
                () =>
                  Ref.update(state, (previous) => ({
                    ...previous,
                    active: previous.active - 1,
                  }))
              ),
          });
        })
      ).pipe(Layer.provideMerge(fake.clientLayer));

      const layer = CalendarService.layer.pipe(Layer.provideMerge(delayed));

      const fiber = yield* CalendarService.use((calendar) =>
        calendar.searchEvents({ ...searchInput, calendars })
      ).pipe(Effect.provide(layer), Effect.forkChild);

      yield* TestClock.adjust((count + 1) * 200);
      const result = yield* Fiber.join(fiber);
      expect((yield* Ref.get(state)).peak).toBe(6);
      expect((yield* Ref.get(state)).active).toBe(0);
      expect((yield* Ref.get(state)).calls).toBe(count * 2);
      expect(result.pageInfo).toHaveLength(count);
    })
);

it.effect("repeating a query rereads Google instead of caching history", () =>
  Effect.gen(function* uncachedSearch() {
    const fake = yield* searchFixture();
    yield* CalendarService.use((calendar) =>
      Effect.gen(function* repeat() {
        yield* calendar.searchEvents(searchInput);
        yield* calendar.searchEvents(searchInput);
      })
    ).pipe(Effect.provide(fake.layer));
    expect(yield* Ref.get(fake.requests)).toHaveLength(4);
  })
);

it.effect(
  "all failed calendars remain explicit rather than looking like no matches",
  () =>
    Effect.gen(function* allFailed() {
      const fake = yield* searchFixture(() => response(403));

      const result = yield* CalendarService.use((calendar) =>
        calendar.searchEvents({
          ...searchInput,
          calendars: [searchCalendar("a"), searchCalendar("b")],
        })
      ).pipe(Effect.provide(fake.layer));

      expect(result.results).toEqual([]);
      expect(result.pageInfo).toEqual([]);
      expect(result.failures.map((failure) => failure.calendarId)).toEqual([
        "a",
        "b",
      ]);
    })
);

it.effect(
  "unexpected provider execution defects do not become partial search success",
  () =>
    Effect.gen(function* unexpectedDefect() {
      const fake = yield* fakeGoogle();
      yield* Ref.set(fake.crashAt, Option.some(1));

      const layer = CalendarService.layer.pipe(
        Layer.provideMerge(
          GoogleCalendarClient.layer.pipe(
            Layer.provideMerge(Layer.merge(fake.layer, memoryCalendarStore))
          )
        )
      );

      const exit = yield* CalendarService.use((calendar) =>
        calendar.searchEvents(searchInput)
      ).pipe(Effect.provide(layer), Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);

      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true);
      }
    })
);

it.effect("invalid primary zones fail before provider requests", () =>
  Effect.gen(function* invalidZone() {
    const fake = yield* searchFixture();

    const failure = yield* CalendarService.use((calendar) =>
      calendar.searchEvents({ ...searchInput, timeZone: "Not/AZone" })
    ).pipe(Effect.provide(fake.layer), Effect.flip);

    expect(failure).toBeInstanceOf(Provider);
    expect(yield* Ref.get(fake.requests)).toEqual([]);
  })
);
