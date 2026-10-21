import type { D1Database } from "@cloudflare/workers-types";
import { and, eq, gt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Clock, Effect } from "effect";

import { CalendarCacheError } from "./calendar-cache-error.js";
import { CalendarRanges, CalendarSnapshots } from "./schema/calendar.js";

export { CalendarCacheError } from "./calendar-cache-error.js";

export interface CalendarCacheKey {
  readonly accountId: string;
  readonly calendarId: string;
}

export interface CalendarCacheSnapshot {
  readonly revision: number;
  readonly version: number;
  readonly cursor: string | null;
}

export const expireCalendarRanges = Effect.fn("expireCalendarRanges")(
  function* expireCalendarRanges(binding: D1Database) {
    const now = yield* Clock.currentTimeMillis;

    const statement = binding
      .prepare(
        "DELETE FROM calendar_range WHERE rowid IN (SELECT rowid FROM calendar_range WHERE expires_at <= ? ORDER BY expires_at LIMIT 1000)"
      )
      .bind(now);

    const result = yield* Effect.tryPromise({
      catch: () => new CalendarCacheError({ operation: "expireRanges" }),

      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () => statement.run(),
    });

    return result.meta.changes;
  }
);

export const calendarCacheRepository = (
  binding: D1Database,
  personId: string
) => {
  const database = drizzle(binding);

  const identity = (key: CalendarCacheKey) => ({ personId, ...key });

  const snapshotWhere = (key: CalendarCacheKey) =>
    and(
      eq(CalendarSnapshots.personId, personId),
      eq(CalendarSnapshots.accountId, key.accountId),
      eq(CalendarSnapshots.calendarId, key.calendarId)
    );

  const ensure = Effect.fn("CalendarCache.ensure")(function* ensure(
    key: CalendarCacheKey
  ) {
    yield* Effect.tryPromise({
      catch: () => new CalendarCacheError({ operation: "ensure" }),
      try: () =>
        database
          .insert(CalendarSnapshots)
          .values(identity(key))
          .onConflictDoNothing(),
    });
  });

  const read = Effect.fn("CalendarCache.read")(function* read(
    key: CalendarCacheKey
  ) {
    const rows = yield* Effect.tryPromise({
      catch: () => new CalendarCacheError({ operation: "read" }),
      try: () =>
        database
          .select()
          .from(CalendarSnapshots)
          .where(snapshotWhere(key))
          .limit(1),
    });

    return rows[0] ?? { cursor: null, revision: 0, version: 0 };
  });

  const compareAndSwap = Effect.fn("CalendarCache.compareAndSwap")(
    function* compareAndSwap(
      key: CalendarCacheKey,
      expectedRevision: number,
      next: CalendarCacheSnapshot
    ) {
      yield* ensure(key);

      const rows = yield* Effect.tryPromise({
        catch: () => new CalendarCacheError({ operation: "compareAndSwap" }),
        try: () =>
          database
            .insert(CalendarSnapshots)
            .values({ ...identity(key), ...next })
            .onConflictDoUpdate({
              set: next,
              setWhere: eq(CalendarSnapshots.revision, expectedRevision),
              target: [
                CalendarSnapshots.personId,
                CalendarSnapshots.accountId,
                CalendarSnapshots.calendarId,
              ],
            })
            .returning({ revision: CalendarSnapshots.revision }),
      });

      return rows.length === 1;
    }
  );

  const readRange = Effect.fn("CalendarCache.readRange")(function* readRange(
    key: CalendarCacheKey,
    start: string,
    end: string,
    version: number,
    now: number
  ) {
    const rows = yield* Effect.tryPromise({
      catch: () => new CalendarCacheError({ operation: "readRange" }),
      try: () =>
        database
          .select({ events: CalendarRanges.events })
          .from(CalendarRanges)
          .where(
            and(
              eq(CalendarRanges.personId, personId),
              eq(CalendarRanges.accountId, key.accountId),
              eq(CalendarRanges.calendarId, key.calendarId),
              eq(CalendarRanges.start, start),
              eq(CalendarRanges.end, end),
              eq(CalendarRanges.version, version),
              gt(CalendarRanges.expiresAt, now),
              sql`EXISTS (SELECT 1 FROM ${CalendarSnapshots} WHERE ${CalendarSnapshots.personId} = ${personId} AND ${CalendarSnapshots.accountId} = ${key.accountId} AND ${CalendarSnapshots.calendarId} = ${key.calendarId} AND ${CalendarSnapshots.version} = ${version})`
            )
          )
          .limit(1),
    });

    return rows[0]?.events;
  });

  const cacheRange = Effect.fn("CalendarCache.cacheRange")(function* cacheRange(
    key: CalendarCacheKey,
    start: string,
    end: string,
    version: number,
    expiresAt: number,
    events: string
  ) {
    yield* ensure(key);

    const statement = binding
      .prepare(`INSERT INTO calendar_range
        (person_id, account_id, calendar_id, version, range_start, range_end, expires_at, events)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM calendar_snapshot WHERE person_id = ? AND account_id = ? AND calendar_id = ? AND version = ?)
        ON CONFLICT (person_id, account_id, calendar_id, version, range_start, range_end)
        DO UPDATE SET expires_at = excluded.expires_at, events = excluded.events`)
      .bind(
        personId,
        key.accountId,
        key.calendarId,
        version,
        start,
        end,
        expiresAt,
        events,
        personId,
        key.accountId,
        key.calendarId,
        version
      );

    const result = yield* Effect.tryPromise({
      catch: () => new CalendarCacheError({ operation: "cacheRange" }),

      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () => statement.run(),
    });

    return result.meta.changes === 1;
  });

  const invalidate = Effect.fn("CalendarCache.invalidate")(function* invalidate(
    key: CalendarCacheKey
  ) {
    yield* ensure(key);

    const rows = yield* Effect.tryPromise({
      catch: () => new CalendarCacheError({ operation: "invalidate" }),
      try: () =>
        database
          .update(CalendarSnapshots)
          .set({
            revision: sql`${CalendarSnapshots.revision} + 1`,
            version: sql`${CalendarSnapshots.version} + 1`,
          })
          .where(snapshotWhere(key))
          .returning({ version: CalendarSnapshots.version }),
    });

    const [row] = rows;

    if (row === undefined) {
      return yield* new CalendarCacheError({ operation: "invalidate" });
    }

    return row.version;
  });

  const hydrateEvent = Effect.fn("CalendarCache.hydrateEvent")(
    function* hydrateEvent(
      key: CalendarCacheKey,
      version: number,
      eventId: string,
      encodedEvent: string
    ) {
      yield* Effect.tryPromise({
        catch: () => new CalendarCacheError({ operation: "hydrateEvent" }),
        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          binding
            .prepare(`UPDATE calendar_range
        SET events = (SELECT json_group_array(json(CASE WHEN json_extract(value, '$.eventId') = ? THEN ? ELSE value END)) FROM json_each(calendar_range.events))
        WHERE person_id = ? AND account_id = ? AND calendar_id = ? AND version = ?
        AND EXISTS (SELECT 1 FROM calendar_snapshot WHERE person_id = ? AND account_id = ? AND calendar_id = ? AND version = ?)
        AND EXISTS (SELECT 1 FROM json_each(calendar_range.events) WHERE json_extract(value, '$.eventId') = ?)`)
            .bind(
              eventId,
              encodedEvent,
              personId,
              key.accountId,
              key.calendarId,
              version,
              personId,
              key.accountId,
              key.calendarId,
              version,
              eventId
            )
            .run(),
      });
    }
  );

  return {
    cacheRange,
    compareAndSwap,
    hydrateEvent,
    invalidate,
    read,
    readRange,
  };
};
