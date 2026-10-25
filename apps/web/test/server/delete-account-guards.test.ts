import { deleteCalendarAccount } from "@calendar/database";
import { calendarCacheRepository } from "@calendar/database/calendar-cache";
import { googlePushRepository } from "@calendar/database/google-push";
import type { PushChannelValue } from "@calendar/database/google-push";
import { expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";

import { d1Fixture } from "./d1-fixture.js";

const pending = (personId: string, id: string): PushChannelValue => ({
  accountId: "account",
  calendarId: "calendar",
  createdAt: 1,
  expiresAt: 9_999_999_999_999,
  id,
  kind: "events",
  personId,
  predecessorId: null,
  resourceId: null,
  state: "pending",
  tokenHash: "a".repeat(64),
});

it.effect(
  "live owners still persist sync data while stale post-deletion writers cannot recreate any non-FK row",
  () =>
    Effect.gen(function* ownerExistenceGuards() {
      const database = yield* d1Fixture;

      for (const person of ["person-a", "person-b"]) {
        const statement = database
          .prepare(
            'INSERT INTO user (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, 1, 1)'
          )
          .bind(person, person, `${person}@example.test`);

        yield* Effect.promise(statement.run.bind(statement));
      }

      const key = { accountId: "account", calendarId: "calendar" };
      const next = { cursor: "provider-cursor", revision: 1, version: 1 };
      const cache = calendarCacheRepository(database, "person-a");
      const other = calendarCacheRepository(database, "person-b");
      const push = googlePushRepository(database);

      const observation = {
        accountId: "account",
        calendarId: "calendar",
        observedAt: 1,
        personId: "person-a",
        reasonCodes: ["forbidden"],
        status: 403,
      } satisfies Parameters<typeof push.markUnsupported>[0];

      expect(yield* cache.compareAndSwap(key, 0, next)).toBe(true);
      expect(
        yield* cache.cacheRange(key, "start", "end", 1, 9_999_999_999_999, "[]")
      ).toBe(true);
      yield* push.insertPending(pending("person-a", "first-channel"));
      yield* push.markUnsupported(observation);
      expect(
        yield* push.unsupported("person-a", { ...key, kind: "events" })
      ).not.toBeNull();
      expect(yield* other.compareAndSwap(key, 0, next)).toBe(true);

      yield* deleteCalendarAccount(database, "person-a");

      expect(yield* cache.compareAndSwap(key, 0, next)).toBe(false);
      expect(
        yield* cache.cacheRange(key, "start", "end", 0, 9_999_999_999_999, "[]")
      ).toBe(false);

      const late = yield* push
        .insertPending(pending("person-a", "late-channel"))
        .pipe(Effect.result);

      expect(Result.isFailure(late)).toBe(true);
      yield* push.markUnsupported(observation);

      for (const table of [
        "calendar_snapshot",
        "calendar_range",
        "google_push_channel",
        "google_push_unsupported",
      ]) {
        const statement = database
          .prepare(`SELECT * FROM ${table} WHERE person_id = ?`)
          .bind("person-a");

        const rows = yield* Effect.promise(statement.all.bind(statement));
        expect(rows.results, table).toEqual([]);
      }

      expect(yield* other.read(key)).toEqual({
        ...key,
        ...next,
        personId: "person-b",
      });
      expect(
        yield* other.compareAndSwap(key, 1, { ...next, revision: 2 })
      ).toBe(true);
      yield* push.insertPending(pending("person-b", "other-channel"));
      yield* push.markUnsupported({ ...observation, personId: "person-b" });
      expect(yield* push.list("person-b")).toHaveLength(1);
      expect(
        yield* push.unsupported("person-b", { ...key, kind: "events" })
      ).not.toBeNull();
    })
);
