import { profileRepository } from "@calendar/database/profile";
import type { D1Database } from "@cloudflare/workers-types";
import { expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";

import { d1Fixture } from "./d1-fixture.js";

const execute = (
  database: D1Database,
  sql: string,
  values: readonly (string | number | null)[] = []
) => {
  const statement = database.prepare(sql).bind(...values);

  return Effect.promise(statement.run.bind(statement));
};

const UserRow = Schema.Struct({
  email: Schema.String,
  id: Schema.String,
  name: Schema.String,
  primaryCalendarAccountId: Schema.NullOr(Schema.String),
});

const users = Effect.fn("test.primaryUsers")(function* users(
  database: D1Database
) {
  const statement = database.prepare(
    'SELECT id, name, email, "primaryCalendarAccountId" FROM "user" ORDER BY id'
  );

  const rows = yield* Effect.promise(statement.all.bind(statement));

  return yield* Schema.decodeUnknownEffect(Schema.Array(UserRow))(rows.results);
});

const fixture = Effect.gen(function* primaryStoreFixture() {
  const database = yield* d1Fixture;

  for (const person of ["a", "b"]) {
    yield* execute(
      database,
      'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, 1, 1)',
      [person, `Person ${person}`, `${person}@example.test`]
    );
    yield* execute(
      database,
      'INSERT INTO "session" (id, token, "userId", "expiresAt", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, 1, 1)',
      [
        `session-${person}`,
        `token-${person}`,
        person,
        "2099-01-01T00:00:00.000Z",
      ]
    );
  }

  for (const [id, person, provider, email, disconnected] of [
    ["a-first", "a", "google", "a@example.test", 0],
    ["a-second", "a", "google", "linked@example.test", 0],
    ["b-first", "b", "google", "b@example.test", 0],
    ["a-other-provider", "a", "other", "linked@example.test", 0],
    ["a-disabled", "a", "google", "linked@example.test", 1],
    ["a-disconnecting", "a", "google", "linked@example.test", 0],
    ["a-not-allowed", "a", "google", "outside@example.test", 0],
  ] as const) {
    yield* execute(
      database,
      'INSERT INTO account (id, "accountId", "providerId", "userId", "createdAt", "updatedAt", "googleEmail", disconnected) VALUES (?, ?, ?, ?, 1, 1, ?, ?)',
      [id, `google-subject-${id}`, provider, person, email, disconnected]
    );
  }

  yield* execute(
    database,
    "INSERT INTO calendar_account_disconnect VALUES ('a', 'a-disconnecting', 'reserved', 1)"
  );

  for (const person of ["a", "b"]) {
    yield* execute(
      database,
      'UPDATE "user" SET "primaryCalendarAccountId" = ? WHERE id = ?',
      [`${person}-first`, person]
    );
  }

  return {
    database,
    repository: profileRepository(
      database,
      "a",
      "a@example.test,linked@example.test,b@example.test"
    ),
  };
});

const input = {
  name: "Updated A",
  sessionId: "session-a",
  sessionToken: "token-a",
};

it.effect(
  "the SQL statement atomically saves A's name and Better Auth account.id without changing either person's login identity",
  () =>
    Effect.gen(function* savePrimary() {
      const { database, repository } = yield* fixture;
      const before = yield* users(database);

      expect(
        yield* repository.save({ ...input, primaryAccountId: "a-second" })
      ).toEqual({ name: "Updated A", primaryAccountId: "a-second" });
      expect(yield* users(database)).toEqual([
        {
          ...before[0],
          name: "Updated A",
          primaryCalendarAccountId: "a-second",
        },
        before[1],
      ]);
      expect(
        yield* repository.save({ ...input, primaryAccountId: "a-second" })
      ).toEqual({ name: "Updated A", primaryAccountId: "a-second" });
    })
);

it.effect.each([
  "b-first",
  "missing",
  "a-other-provider",
  "a-disabled",
  "a-disconnecting",
  "a-not-allowed",
  "google-subject-a-second",
  "a-second' OR 1=1 --",
])(
  "SQL itself refuses unavailable choice %s without a partial name write or a B mutation",
  (primaryAccountId) =>
    Effect.gen(function* refusePrimary() {
      const { database, repository } = yield* fixture;
      const before = yield* users(database);

      expect(yield* repository.save({ ...input, primaryAccountId })).toBeNull();
      expect(yield* users(database)).toEqual(before);
    })
);

it.effect.each([
  { sessionId: "session-b", sessionToken: "token-b" },
  { sessionId: "missing", sessionToken: "token-a" },
  { sessionId: "session-a", sessionToken: "wrong-token" },
])(
  "SQL itself refuses a non-current session $sessionId/$sessionToken",
  (session) =>
    Effect.gen(function* refuseSession() {
      const { database, repository } = yield* fixture;
      const before = yield* users(database);

      expect(
        yield* repository.save({
          ...input,
          ...session,
          primaryAccountId: "a-second",
        })
      ).toBeNull();
      expect(yield* users(database)).toEqual(before);
    })
);

it.effect.each(["expired", "revoked"] as const)(
  "SQL refuses a session that became %s after authentication",
  (kind) =>
    Effect.gen(function* lateSessionRefusal() {
      const { database, repository } = yield* fixture;
      const before = yield* users(database);
      yield* execute(
        database,
        kind === "expired"
          ? "UPDATE \"session\" SET \"expiresAt\" = '1960-01-01T00:00:00.000Z' WHERE id = 'session-a'"
          : "DELETE FROM \"session\" WHERE id = 'session-a'"
      );

      expect(
        yield* repository.save({ ...input, primaryAccountId: "a-second" })
      ).toBeNull();
      expect(yield* users(database)).toEqual(before);
    })
);

it.effect(
  "name-only saves preserve a disconnected selected pointer; removing its account sets NULL and preserves B",
  () =>
    Effect.gen(function* unlinkPrimary() {
      const { database, repository } = yield* fixture;
      const before = yield* users(database);
      yield* execute(
        database,
        "UPDATE account SET disconnected = 1 WHERE id = 'a-first'"
      );

      expect(yield* repository.save(input)).toEqual({
        name: "Updated A",
        primaryAccountId: "a-first",
      });
      yield* execute(database, "DELETE FROM account WHERE id = 'a-first'");
      expect(yield* users(database)).toEqual([
        { ...before[0], name: "Updated A", primaryCalendarAccountId: null },
        before[1],
      ]);
      expect(
        yield* repository.save({ ...input, primaryAccountId: "a-second" })
      ).toEqual({ name: "Updated A", primaryAccountId: "a-second" });
    })
);

it.effect(
  "a late save cannot resurrect a deleted person or its selected pointer",
  () =>
    Effect.gen(function* deletedPrimaryOwner() {
      const { database, repository } = yield* fixture;
      const before = yield* users(database);
      yield* execute(database, "DELETE FROM \"user\" WHERE id = 'a'");

      expect(
        yield* repository.save({ ...input, primaryAccountId: "a-second" })
      ).toBeNull();
      expect(yield* users(database)).toEqual([before[1]]);
    })
);

it.effect(
  "malformed store input is a typed refusal before any durable change",
  () =>
    Effect.gen(function* malformedProfileInput() {
      const { database, repository } = yield* fixture;
      const before = yield* users(database);

      const result = yield* repository
        .save({ ...input, name: "" })
        .pipe(Effect.result);

      expect(Result.isFailure(result)).toBe(true);
      expect(yield* users(database)).toEqual(before);
    })
);
