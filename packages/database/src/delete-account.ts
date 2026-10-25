import type { D1Database } from "@cloudflare/workers-types";
import { Effect, Schema } from "effect";

import { PushChannel } from "./google-push.js";

export class AccountDeletionStoreError extends Schema.TaggedError<AccountDeletionStoreError>()(
  "AccountDeletionStoreError",
  {}
) {}

export const accountDeletionChannels = Effect.fn("accountDeletionChannels")(
  function* accountDeletionChannels(
    database: D1Database,
    personId: string,
    after = ""
  ) {
    const statement = database
      .prepare(`SELECT id, person_id AS personId, account_id AS accountId, calendar_id AS calendarId,
        kind, token_hash AS tokenHash, resource_id AS resourceId, expires_at AS expiresAt,
        created_at AS createdAt, predecessor_id AS predecessorId, state
        FROM google_push_channel WHERE person_id = ? AND id > ? AND resource_id IS NOT NULL AND state <> 'stopped'
        ORDER BY id LIMIT 100`)
      .bind(personId, after);

    const result = yield* Effect.tryPromise({
      catch: () => new AccountDeletionStoreError(),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () => statement.all(),
    });

    return yield* Schema.decodeUnknownEffect(Schema.Array(PushChannel))(
      result.results
    ).pipe(Effect.mapError(() => new AccountDeletionStoreError()));
  }
);

const verificationJson = "CASE WHEN json_valid(value) THEN value ELSE '{}' END";

export const deleteCalendarAccount = Effect.fn("deleteCalendarAccount")(
  function* deleteCalendarAccount(database: D1Database, personId: string) {
    const person = yield* Schema.decodeEffect(Schema.NonEmptyString)(
      personId
    ).pipe(Effect.mapError(() => new AccountDeletionStoreError()));

    const statements = [
      ...[
        "calendar_range",
        "calendar_snapshot",
        "google_push_channel",
        "google_push_unsupported",
        "calendar_account_disconnect",
        "calendar_account_conferencing",
      ].map((table) =>
        database
          .prepare(`DELETE FROM ${table} WHERE person_id = ?`)
          .bind(person)
      ),
      database
        .prepare(`DELETE FROM verification WHERE
          (identifier GLOB 'calendar-desktop:*' AND json_extract(${verificationJson}, '$.personId') = ?)
          OR (identifier = json_extract(${verificationJson}, '$.oauthState') AND json_extract(${verificationJson}, '$.link.userId') = ?)
          OR (value = ? AND (identifier GLOB 'delete-account-*' OR identifier GLOB 'reset-password:*'))`)
        .bind(person, person, person),
      database.prepare('DELETE FROM "session" WHERE "userId" = ?').bind(person),
      database.prepare('DELETE FROM "account" WHERE "userId" = ?').bind(person),
      database.prepare('DELETE FROM "user" WHERE id = ?').bind(person),
    ];

    yield* Effect.tryPromise({
      catch: () => new AccountDeletionStoreError(),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () => database.batch(statements),
    });
  }
);
