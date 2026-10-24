import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";

import { CalendarService } from "../src/calendar.js";
import { SearchPageTarget } from "../src/search-model.js";
import { response, timedEvent } from "./fake-google.js";
import { searchFixture, searchInput } from "./search-fixture.js";

const window = {
  boundary: "2026-02-10T00:00:00.000Z",
  endExclusive: "2029-02-11T00:00:00.000Z",
  historyStart: "2016-03-15T00:00:00.000Z",
};

const reverseInput = (windowEnd: string, pageToken?: string) => ({
  ...searchInput,
  continuation: {
    pages: [
      SearchPageTarget.cases.Reverse.make({
        accountId: "account",
        calendarId: "calendar",
        pageToken,
        windowEnd,
      }),
    ],
    window,
  },
  timeZone: "UTC",
});

it.effect.prop(
  "reverse finishes its own calendar's opaque token inside the fixed window before moving backward",
  { serial: Schema.Int },
  ({ serial }) =>
    Effect.gen(function* olderToken() {
      yield* TestClock.setTime(
        DateTime.toEpochMillis(DateTime.makeUnsafe("2030-01-01T00:00:00Z"))
      );
      const token = `older+/%=${serial}`;

      const fake = yield* searchFixture(() =>
        response(200, { items: [timedEvent("retained")], nextPageToken: token })
      );

      const result = yield* CalendarService.use((calendar) =>
        calendar.searchEvents(reverseInput("2025-02-10T00:00:00.000Z", token))
      ).pipe(Effect.provide(fake.layer));

      const requests = yield* Ref.get(fake.requests);
      expect(requests).toHaveLength(1);
      const url = new URL(`https://fake.test${requests[0]?.path}`);
      expect(url.searchParams.get("timeMin")).toBe("2024-02-11T00:00:00.000Z");
      expect(url.searchParams.get("timeMax")).toBe("2025-02-10T00:00:00.000Z");
      expect(url.searchParams.get("pageToken")).toBe(token);
      expect(url.searchParams.get("maxResults")).toBe("500");
      expect(result.window).toEqual(window);
      expect(result.pageInfo[0]?.olderCursor).toEqual({
        pageToken: token,
        windowEnd: "2025-02-10T00:00:00.000Z",
      });
    })
);

it.effect(
  "three empty windows spend one trigger's budget without pretending history is exhausted",
  () =>
    Effect.gen(function* boundedEmptyWindows() {
      const fake = yield* searchFixture(() => response(200, { items: [] }));

      const result = yield* CalendarService.use((calendar) =>
        calendar.searchEvents(reverseInput("2025-02-10T00:00:00.000Z"))
      ).pipe(Effect.provide(fake.layer));

      const requests = yield* Ref.get(fake.requests);
      expect(requests).toHaveLength(3);
      expect(
        requests.map((request) =>
          new URL(`https://fake.test${request.path}`).searchParams.get(
            "timeMax"
          )
        )
      ).toEqual([
        "2025-02-10T00:00:00.000Z",
        "2024-02-11T00:00:00.000Z",
        "2023-02-11T00:00:00.000Z",
      ]);
      expect(result.pageInfo[0]?.olderCursor).toEqual({
        windowEnd: "2022-02-11T00:00:00.000Z",
      });
      expect(result.pageInfo[0]?.olderHasMore).toBe(true);
      expect(result.results).toEqual([]);
    })
);

it.effect(
  "a nonempty preceding window ends this trigger and retains the next older window",
  () =>
    Effect.gen(function* precedingWindow() {
      const fake = yield* searchFixture(() =>
        response(200, { items: [timedEvent("older-match")] })
      );

      const result = yield* CalendarService.use((calendar) =>
        calendar.searchEvents(reverseInput("2025-02-10T00:00:00.000Z"))
      ).pipe(Effect.provide(fake.layer));

      expect(yield* Ref.get(fake.requests)).toHaveLength(1);
      expect(result.results.map((row) => row.event.eventId)).toEqual([
        "older-match",
      ]);
      expect(result.pageInfo[0]?.olderCursor).toEqual({
        windowEnd: "2024-02-11T00:00:00.000Z",
      });
    })
);

it.effect(
  "the final window clamps to the pinned horizon and a horizon cursor performs no provider read",
  () =>
    Effect.gen(function* historyHorizon() {
      const fake = yield* searchFixture(() => response(200, { items: [] }));

      const result = yield* CalendarService.use((calendar) =>
        calendar.searchEvents(reverseInput("2016-06-01T00:00:00.000Z"))
      ).pipe(Effect.provide(fake.layer));

      const requests = yield* Ref.get(fake.requests);
      expect(requests).toHaveLength(1);
      const url = new URL(`https://fake.test${requests[0]?.path}`);
      expect(url.searchParams.get("timeMin")).toBe(window.historyStart);
      expect(result.pageInfo[0]?.olderHasMore).toBe(false);
      expect(result.pageInfo[0]?.olderCursor).toBeUndefined();
      yield* CalendarService.use((calendar) =>
        calendar.searchEvents(reverseInput(window.historyStart))
      ).pipe(Effect.provide(fake.layer));
      expect(yield* Ref.get(fake.requests)).toHaveLength(1);
    })
);

it.effect(
  "a reverse provider failure stays a calendar failure instead of a quiet history end",
  () =>
    Effect.gen(function* failedHistory() {
      const fake = yield* searchFixture(() => response(403));

      const result = yield* CalendarService.use((calendar) =>
        calendar.searchEvents(
          reverseInput("2025-02-10T00:00:00.000Z", "retry-me")
        )
      ).pipe(Effect.provide(fake.layer));

      expect(result.pageInfo).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.calendarId).toBe("calendar");
    })
);
