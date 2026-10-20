import type { D1Database } from "@cloudflare/workers-types";
import { Effect, Schema } from "effect";

import { AccountConferencingDefaultStoreError } from "./account-conferencing-default-error.js";

const StoredChoice = Schema.Literals(["unset", "none", "googleMeet"]);

const Input = Schema.Struct({
  accountId: Schema.NonEmptyString,
  value: StoredChoice,
});

const Row = Schema.Struct({
  accountId: Schema.NonEmptyString,
  value: StoredChoice,
});

const failure = (operation: string) =>
  new AccountConferencingDefaultStoreError({ operation });

const activeOwner = `owner.userId = ? AND owner.id = ? AND owner.providerId = 'google'
AND NOT EXISTS (SELECT 1 FROM calendar_account_disconnect AS disconnected WHERE disconnected.person_id = owner.userId AND disconnected.account_id = owner.id)`;

export const accountConferencingDefaultRepository = (
  database: D1Database,
  personId: string
) => ({
  get: Effect.fn("accountConferencingDefault.get")(function* get(
    accountId: string
  ) {
    yield* Schema.decodeEffect(Schema.NonEmptyString)(accountId).pipe(
      Effect.mapError(() => failure("invalidInput"))
    );

    const row: unknown = yield* Effect.tryPromise({
      catch: () => failure("get"),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        database
          .prepare(`SELECT owner.id AS accountId, coalesce(preference.value, 'unset') AS value
      FROM account AS owner LEFT JOIN calendar_account_conferencing AS preference ON preference.person_id = owner.userId AND preference.account_id = owner.id
      WHERE ${activeOwner}`)
          .bind(personId, accountId)
          .first(),
    });

    return yield* Schema.decodeUnknownEffect(Schema.NullOr(Row))(row).pipe(
      Effect.mapError(() => failure("storedChoice"))
    );
  }),
  set: Effect.fn("accountConferencingDefault.set")(function* set(
    input: typeof Input.Type
  ) {
    const valid = yield* Schema.decodeEffect(Input)(input).pipe(
      Effect.mapError(() => failure("invalidInput"))
    );

    const row: unknown = yield* Effect.tryPromise({
      catch: () => failure("set"),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        database
          .prepare(`INSERT INTO calendar_account_conferencing (person_id, account_id, value)
      SELECT owner.userId, owner.id, ? FROM account AS owner WHERE ${activeOwner}
      ON CONFLICT (person_id, account_id) DO UPDATE SET value = excluded.value
      RETURNING account_id AS accountId, value`)
          .bind(valid.value, personId, valid.accountId)
          .first(),
    });

    return yield* Schema.decodeUnknownEffect(Schema.NullOr(Row))(row).pipe(
      Effect.mapError(() => failure("storedChoice"))
    );
  }),
});
