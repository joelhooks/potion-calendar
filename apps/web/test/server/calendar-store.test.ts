import { CalendarEvent, CalendarStore } from "@calendar/calendar";
import { calendarStoreContract } from "@calendar/calendar/testing";
import { expireCalendarRanges } from "@calendar/database/calendar-cache";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { afterAll, beforeAll } from "vitest";

import {
  d1CalendarStore,
  calendarRangeTtlMs,
  calendarRangeCacheByteLimit,
} from "../../src/server/calendar-store.js";
import { calendarMigration, d1Fixture, makeD1Instance } from "./d1-fixture.js";

describe("D1 contract histories", { timeout: 30_000 }, () => {
  const instance = makeD1Instance();

  // @effect-diagnostics-next-line asyncFunction:off -- Vitest owns the native fixture setup lifecycle.
  beforeAll(async () => {
    const database = await instance.getD1Database("DB");

    const statements = calendarMigration
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => database.prepare(statement));

    await database.batch(statements);
  });
  afterAll(instance.dispose.bind(instance));

  calendarStoreContract("D1 calendar store", () =>
    Layer.unwrap(
      Effect.gen(function* isolatedStore() {
        const database = yield* Effect.promise(
          instance.getD1Database.bind(instance, "DB", undefined)
        );

        yield* Effect.promise(
          database.batch.bind(database, [
            database.prepare("DELETE FROM calendar_range"),
            database.prepare("DELETE FROM calendar_snapshot"),
          ])
        );

        return d1CalendarStore(database, "person");
      })
    )
  );
});

const ref = { accountId: "account", calendarId: "calendar" };

const range = { end: "2026-11-02T00:00:00Z", start: "2026-10-19T00:00:00Z" };

it.effect("D1 cursor CAS has one winner and stale resets cannot erase it", () =>
  Effect.gen(function* concurrentCursor() {
    const database = yield* d1Fixture;

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
      const database = yield* d1Fixture;

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
      const database = yield* d1Fixture;

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
    const database = yield* d1Fixture;

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
      const database = yield* d1Fixture;

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
      const database = yield* d1Fixture;

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
      const database = yield* d1Fixture;

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
