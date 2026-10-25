import { deleteCalendarAccount } from "@calendar/database";
import type { D1Database } from "@cloudflare/workers-types";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { d1Fixture } from "./d1-fixture.js";

const tables = [
  "calendar_range",
  "calendar_snapshot",
  "google_push_channel",
  "google_push_unsupported",
  "calendar_account_disconnect",
  "calendar_account_conferencing",
  "verification",
  "session",
  "account",
  "user",
] as const;

const execute = (
  database: D1Database,
  sql: string,
  values: readonly (string | number | null)[] = []
) => {
  const statement = database.prepare(sql).bind(...values);

  return Effect.promise(statement.run.bind(statement));
};

const seed = Effect.fn("deleteAccount.seed")(function* seed(
  database: D1Database
) {
  for (const person of ["person-a", "person-b"]) {
    const account = `${person}-google`;
    yield* execute(
      database,
      'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, 1, 1)',
      [person, person, `${person}@example.test`]
    );
    yield* execute(
      database,
      'INSERT INTO account (id, "accountId", "providerId", "userId", "createdAt", "updatedAt", disconnected) VALUES (?, ?, ?, ?, 1, 1, 0)',
      [account, account, "google", person]
    );

    for (const suffix of ["browser", "desktop"]) {
      yield* execute(
        database,
        'INSERT INTO session (id, "expiresAt", token, "createdAt", "updatedAt", "userId") VALUES (?, 9999999999999, ?, 1, 1, ?)',
        [`${person}-${suffix}`, `${person}-${suffix}-token`, person]
      );
    }

    yield* execute(
      database,
      "INSERT INTO calendar_snapshot VALUES (?, ?, 'calendar', 2, 3, 'cursor')",
      [person, account]
    );
    yield* execute(
      database,
      "INSERT INTO calendar_range VALUES (?, ?, 'calendar', 3, '2026-01-01', '2026-01-08', 9999999999999, '[]')",
      [person, account]
    );

    for (const state of ["active", "orphaned"]) {
      yield* execute(
        database,
        "INSERT INTO google_push_channel (id, person_id, account_id, calendar_id, kind, token_hash, resource_id, expires_at, created_at, state) VALUES (?, ?, ?, 'calendar', 'events', 'fake-hash', 'fake-resource', 9999999999999, 1, ?)",
        [`${person}-${state}`, person, account, state]
      );
    }

    yield* execute(
      database,
      "INSERT INTO google_push_unsupported VALUES (?, ?, 'calendar', 403, '[\"forbidden\"]', 1)",
      [person, account]
    );
    yield* execute(
      database,
      "INSERT INTO calendar_account_conferencing VALUES (?, ?, 'googleMeet')",
      [person, account]
    );
    yield* execute(
      database,
      "INSERT INTO calendar_account_disconnect VALUES (?, ?, 'done', 1)",
      [person, account]
    );

    const records = [
      {
        identifier: `calendar-desktop:${person}`,
        value: JSON.stringify({
          personId: person,
          sessionToken: `${person}-desktop-token`,
        }),
      },
      {
        identifier: `${person}-oauth`,
        value: JSON.stringify({
          link: { userId: person },
          oauthState: `${person}-oauth`,
        }),
      },
      { identifier: `delete-account-${person}`, value: person },
      { identifier: `reset-password:${person}`, value: person },
    ];

    for (const record of records) {
      yield* execute(
        database,
        'INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES (?, ?, ?, 9999999999999, 1, 1)',
        [record.identifier, record.identifier, record.value]
      );
    }
  }

  for (const [identifier, value] of [
    ["unowned-sign-in", '{"oauthState":"unowned-sign-in"}'],
    ["unrecognized-text", "person-a"],
    ["unrecognized-json", '{"personId":"person-a"}'],
    ["calendar-desktop:invalid-json", "not-json"],
  ] as const) {
    yield* execute(
      database,
      'INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES (?, ?, ?, 9999999999999, 1, 1)',
      [identifier, identifier, value]
    );
  }
});

const snapshot = Effect.fn("deleteAccount.snapshot")(function* snapshot(
  database: D1Database
) {
  const rows = yield* Effect.forEach((table: (typeof tables)[number]) => {
    const statement = database.prepare(`SELECT * FROM ${table} ORDER BY rowid`);

    return Effect.promise(statement.all.bind(statement)).pipe(
      Effect.map((result) => [table, result.results] as const)
    );
  })(tables);

  return Object.fromEntries(rows);
});

it.effect.each(["person-a", "person-b"])(
  "one SQLite batch removes every owned family for %s and preserves the other person and unowned tokens",
  (person) =>
    Effect.gen(function* deleteOnePerson() {
      const database = yield* d1Fixture;
      yield* seed(database);
      const before = yield* snapshot(database);
      yield* deleteCalendarAccount(database, person);
      const after = yield* snapshot(database);

      for (const table of tables) {
        const expected = before[table]?.filter((row) => {
          if (table === "verification") {
            return ![
              `calendar-desktop:${person}`,
              `${person}-oauth`,
              `delete-account-${person}`,
              `reset-password:${person}`,
            ].includes(String(row.identifier));
          }

          return (
            row.person_id !== person &&
            row.userId !== person &&
            !(table === "user" && row.id === person)
          );
        });

        expect(after[table], table).toEqual(expected);
      }

      const once = yield* snapshot(database);
      yield* deleteCalendarAccount(database, person);
      expect(yield* snapshot(database)).toEqual(once);
    })
);

it.effect(
  "a failure at the final user delete rolls back every earlier row-family delete",
  () =>
    Effect.gen(function* deleteRollback() {
      const database = yield* d1Fixture;
      yield* seed(database);
      yield* execute(
        database,
        "CREATE TRIGGER refuse_delete BEFORE DELETE ON user WHEN OLD.id = 'person-a' BEGIN SELECT RAISE(ABORT, 'qualified local deletion failure'); END"
      );
      const before = yield* snapshot(database);

      const error = yield* deleteCalendarAccount(database, "person-a").pipe(
        Effect.flip
      );

      expect(error._tag).toBe("AccountDeletionStoreError");
      expect(yield* snapshot(database)).toEqual(before);
    })
);
