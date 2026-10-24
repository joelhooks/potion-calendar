import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Ref } from "effect";
import { TestClock } from "effect/testing";

import { CalendarService } from "../src/calendar.js";
import { SearchPageTarget } from "../src/search-model.js";
import { response } from "./fake-google.js";
import { searchFixture, searchInput } from "./search-fixture.js";

it.effect(
  "initial history starts in the newest 365-day window instead of the oldest unbounded matches",
  () =>
    Effect.gen(function* newestInitialHistory() {
      yield* TestClock.setTime(
        DateTime.toEpochMillis(DateTime.makeUnsafe("2026-03-15T17:00:00Z"))
      );
      const fake = yield* searchFixture(() => response(200, { items: [] }));

      const result = yield* CalendarService.use((calendar) =>
        calendar.searchEvents({ ...searchInput, timeZone: "UTC" })
      ).pipe(Effect.provide(fake.layer));

      const requests = yield* Ref.get(fake.requests);
      const older = new URL(`https://fake.test${requests[1]?.path}`);
      expect(older.searchParams.get("timeMin")).toBe(
        "2025-02-09T00:00:00.000Z"
      );
      expect(older.searchParams.get("timeMax")).toBe(result.window.boundary);
      expect(older.searchParams.get("maxResults")).toBe("2500");
    })
);

it.effect(
  "forward continuation asks for 500 rows without changing the initial 100-row request",
  () =>
    Effect.gen(function* nominalForwardBatch() {
      const fake = yield* searchFixture(() =>
        response(200, { items: [], nextPageToken: "forward-token" })
      );

      const first = yield* CalendarService.use((calendar) =>
        calendar.searchEvents(searchInput)
      ).pipe(Effect.provide(fake.layer));

      yield* CalendarService.use((calendar) =>
        calendar.searchEvents({
          ...searchInput,
          continuation: {
            pages: [
              SearchPageTarget.cases.Forward.make({
                accountId: "account",
                calendarId: "calendar",
                pageToken: "forward-token",
              }),
            ],
            window: first.window,
          },
        })
      ).pipe(Effect.provide(fake.layer));
      const requests = yield* Ref.get(fake.requests);
      const initial = new URL(`https://fake.test${requests[0]?.path}`);
      const continued = new URL(`https://fake.test${requests[2]?.path}`);
      expect(initial.searchParams.get("maxResults")).toBe("100");
      expect(continued.searchParams.get("maxResults")).toBe("500");
      expect(continued.searchParams.get("pageToken")).toBe("forward-token");
    })
);
