import { CalendarEvent, CalendarStore } from "@calendar/calendar";
import { calendarStoreContractWith } from "@calendar/calendar/testing";
import { expireCalendarRanges } from "@calendar/database/calendar-cache";
import { describe, expect, it } from "@effect/vitest";
import { Clock, Effect, Predicate, Schema } from "effect";
import { TestClock } from "effect/testing";

import {
  d1CalendarStore,
  calendarRangeTtlMs,
  calendarRangeCacheByteLimit,
} from "../../src/server/calendar-store.js";
import { d1Fixture, seedCalendarCacheOwners } from "./d1-fixture.js";
import {
  nativeHistoryStore,
  runNativeStoreHistory,
  StoreHistoryFixture,
} from "./store-history-fixture.js";

const ref = { accountId: "account", calendarId: "calendar" };

const ownedCalendarCache = d1Fixture.pipe(
  Effect.tap((database) =>
    seedCalendarCacheOwners(database, ["person", "first", "second"])
  )
);

describe("D1 contract histories", { timeout: 30_000 }, () => {
  it.layer(StoreHistoryFixture.layer)((test) => {
    calendarStoreContractWith("D1 calendar store", () => nativeHistoryStore, {
      effect: test.effect,
      history: runNativeStoreHistory,
    });

    test.effect(
      "native history requests reset D1 and local services even for an empty history, preserve undefined cursors, and use the host test clock",
      () =>
        Effect.gen(function* historyIsolation() {
          const fixture = yield* StoreHistoryFixture;
          const clock = yield* Clock.currentTimeMillis;

          const firstSteps = yield* fixture.run([
            "read",
            "emptySync",
            "read",
            "changedSync",
            "read",
            "write",
            "read",
          ]);

          expect(firstSteps.map((step) => step._tag)).toEqual(
            Array.from({ length: 7 }, () => "Observed")
          );

          const first = firstSteps.filter((step) =>
            Predicate.isTagged(step, "Observed")
          );

          expect(first).toHaveLength(7);
          expect(first.map((step) => step.clockMilliseconds)).toEqual(
            Array.from({ length: 7 }, () => clock)
          );
          expect(first[6]?.snapshot).toEqual({
            cursor: "cursor-3",
            revision: 3,
            version: 2,
          });
          expect(first[6]?.requests).toHaveLength(7);
          expect(first[6]?.published).toEqual([
            { ...ref, reason: "sync", version: 1 },
            { ...ref, reason: "write", version: 2 },
          ]);
          expect(first[6]?.pending).toEqual([]);
          expect(yield* fixture.run([])).toEqual([]);

          const store = yield* CalendarStore.pipe(
            Effect.provide(d1CalendarStore(fixture.database, "person"))
          );

          expect(yield* store.read(ref)).toEqual({
            cursor: undefined,
            revision: 0,
            version: 0,
          });
          yield* TestClock.adjust(calendarRangeTtlMs + 1);
          const laterClock = yield* Clock.currentTimeMillis;
          const secondSteps = yield* fixture.run(["read", "emptySync", "read"]);

          expect(secondSteps.map((step) => step._tag)).toEqual(
            Array.from({ length: 3 }, () => "Observed")
          );

          const second = secondSteps.filter((step) =>
            Predicate.isTagged(step, "Observed")
          );

          expect(second).toHaveLength(3);
          expect(second[0]?.snapshot.cursor).toBeUndefined();
          expect(second[0]?.snapshot.version).toBe(0);
          expect(second[0]?.published).toEqual([]);
          expect(second[0]?.requests).toHaveLength(1);
          expect(second[2]?.requests).toHaveLength(2);
          expect(
            second[2]?.listed?.events.map((event) => event.eventId)
          ).toEqual(["event"]);
          expect(second[2]?.pending).toEqual([]);
          expect(second.map((step) => step.clockMilliseconds)).toEqual(
            Array.from({ length: 3 }, () => laterClock)
          );
        })
    );
  });
});

const range = { end: "2026-11-02T00:00:00Z", start: "2026-10-19T00:00:00Z" };

it.effect("D1 cursor CAS has one winner and stale resets cannot erase it", () =>
  Effect.gen(function* concurrentCursor() {
    const database = yield* ownedCalendarCache;

    const store = yield* CalendarStore.pipe(
      Effect.provide(d1CalendarStore(database, "person"))
    );

    const results = yield* Effect.all(
      [
        store.commit(ref, 0, 0, "cursor-a"),
        store.commit(ref, 0, 0, "cursor-b"),
      ],
      { concurrency: "unbounded" }
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    const snapshot = yield* store.read(ref);

    expect(snapshot.revision).toBe(1);
    expect(snapshot.cursor).toBe(results[0] ? "cursor-a" : "cursor-b");
    expect(yield* store.clear(ref, 0)).toBe(false);
    expect(yield* store.read(ref)).toEqual(snapshot);
  })
);

it.effect(
  "D1 partitions cached data by person and rejects obsolete versions",
  () =>
    Effect.gen(function* isolatedRange() {
      const database = yield* ownedCalendarCache;

      const first = yield* CalendarStore.pipe(
        Effect.provide(d1CalendarStore(database, "first"))
      );

      const second = yield* CalendarStore.pipe(
        Effect.provide(d1CalendarStore(database, "second"))
      );

      expect(yield* first.cacheRange(ref, range, 0, [])).toBe(true);
      expect(yield* first.readRange(ref, range, 0)).toEqual([]);
      expect(yield* second.readRange(ref, range, 0)).toBeUndefined();
      expect(yield* first.invalidate(ref)).toBe(1);
      expect(yield* first.readRange(ref, range, 0)).toBeUndefined();
      expect(yield* first.cacheRange(ref, range, 0, [])).toBe(false);
      expect(yield* second.read(ref)).toEqual({
        cursor: undefined,
        revision: 0,
        version: 0,
      });
    })
);

it.effect(
  "D1 persists constant-size metadata after large and small change counts",
  () =>
    Effect.gen(function* metadataRows() {
      const database = yield* ownedCalendarCache;

      const store = yield* CalendarStore.pipe(
        Effect.provide(d1CalendarStore(database, "person"))
      );

      const statement = database.prepare("SELECT * FROM calendar_snapshot");

      const Rows = Schema.Struct({
        results: Schema.NonEmptyArray(
          Schema.Record(Schema.String, Schema.Json)
        ),
      });

      expect(yield* store.commit(ref, 0, 5000, "cursor")).toBe(true);

      const first = yield* Effect.promise(statement.all.bind(statement)).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Rows))
      );

      expect(first.results[0]).not.toHaveProperty("events");
      expect(yield* store.commit(ref, 1, 1, "cursor")).toBe(true);

      const second = yield* Effect.promise(statement.all.bind(statement)).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Rows))
      );

      expect(JSON.stringify(second.results[0]).length).toBe(
        JSON.stringify(first.results[0]).length
      );
    })
);

it.effect("D1 range cache expires without changing the calendar version", () =>
  Effect.gen(function* expiringRange() {
    const database = yield* ownedCalendarCache;

    const store = yield* CalendarStore.pipe(
      Effect.provide(d1CalendarStore(database, "person"))
    );

    expect(yield* store.cacheRange(ref, range, 0, [])).toBe(true);
    yield* TestClock.adjust(calendarRangeTtlMs);
    expect(yield* store.readRange(ref, range, 0)).toBeUndefined();
    expect((yield* store.read(ref)).version).toBe(0);
    expect(yield* expireCalendarRanges(database)).toBe(1);
  })
);

it.effect(
  "oversized ranges skip caching without changing the live-read or stale-version result",
  () =>
    Effect.gen(function* boundedRange() {
      const database = yield* ownedCalendarCache;

      const store = yield* CalendarStore.pipe(
        Effect.provide(d1CalendarStore(database, "person"))
      );

      const event = CalendarEvent.make({
        ...ref,
        description: "🗓".repeat(calendarRangeCacheByteLimit / 4),
        eventId: "large",
        status: "confirmed",
      });

      expect(yield* store.cacheRange(ref, range, 0, [event])).toBe(true);
      expect(yield* store.readRange(ref, range, 0)).toBeUndefined();
      yield* store.invalidate(ref);
      expect(yield* store.cacheRange(ref, range, 0, [event])).toBe(false);
    })
);

it.effect(
  "D1 rejects cross-calendar ranges and malformed stored cache data",
  () =>
    Effect.gen(function* cacheCodec() {
      const database = yield* ownedCalendarCache;

      const store = yield* CalendarStore.pipe(
        Effect.provide(d1CalendarStore(database, "person"))
      );

      const event = CalendarEvent.make({
        ...ref,
        accountId: "other",
        eventId: "event",
        status: "confirmed",
      });

      const failure = yield* store
        .cacheRange(ref, range, 0, [event])
        .pipe(Effect.flip);

      expect(failure._tag).toBe("Provider");
      expect(yield* store.readRange(ref, range, 0)).toBeUndefined();
      yield* store.cacheRange(ref, range, 0, []);

      const statement = database.prepare(
        "UPDATE calendar_range SET events = '{}' WHERE person_id = 'person'"
      );

      yield* Effect.promise(statement.run.bind(statement));
      const corrupt = yield* store.readRange(ref, range, 0).pipe(Effect.flip);

      expect(corrupt._tag).toBe("Provider");
    })
);

it.effect(
  "range expiration uses the expiration index rather than calendar invalidation scans",
  () =>
    Effect.gen(function* expiryPlan() {
      const database = yield* ownedCalendarCache;

      const query = database
        .prepare(
          "EXPLAIN QUERY PLAN SELECT rowid FROM calendar_range WHERE expires_at <= ? ORDER BY expires_at LIMIT 1000"
        )
        .bind(0);

      const rows = yield* Effect.promise(query.all.bind(query));

      const plan = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          results: Schema.Array(Schema.Struct({ detail: Schema.String })),
        })
      )(rows);

      expect(
        plan.results.some((row) =>
          row.detail.includes("calendar_range_expiration")
        )
      ).toBe(true);
    })
);
