import type { D1Database } from "@cloudflare/workers-types";
import { Clock, Effect, Schema } from "effect";

import { AccountDisconnectStoreError } from "./account-disconnect-error.js";

export const DisconnectPhase = Schema.Literals([
  "reserved",
  "stopped",
  "removed",
  "done",
]);

export const DisconnectReceipt = Schema.Struct({
  accountId: Schema.NonEmptyString,
  createdAt: Schema.Int,
  personId: Schema.NonEmptyString,
  phase: DisconnectPhase,
});

export type DisconnectReceiptValue = typeof DisconnectReceipt.Type;

export const Reservation = Schema.Union([
  Schema.TaggedStruct("LastAccount", {}),
  Schema.TaggedStruct("NotOwned", {}),
  Schema.TaggedStruct("Reserved", { receipt: DisconnectReceipt }),
]).pipe(Schema.toTaggedUnion("_tag"));

const failure = (operation: string) =>
  new AccountDisconnectStoreError({ operation });

const columns =
  "person_id AS personId, account_id AS accountId, phase, created_at AS createdAt";

export const accountDisconnectRepository = (
  database: D1Database,
  personId: string
) => {
  const load = Effect.fn("disconnectReceipt.load")(function* load(
    accountId: string
  ) {
    const row: unknown = yield* Effect.tryPromise({
      catch: () => failure("load"),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        database
          .prepare(
            `SELECT ${columns} FROM calendar_account_disconnect WHERE person_id = ? AND account_id = ?`
          )
          .bind(personId, accountId)
          .first(),
    });

    return yield* Schema.decodeUnknownEffect(Schema.NullOr(DisconnectReceipt))(
      row
    ).pipe(Effect.mapError(() => failure("storedReceipt")));
  });

  const begin = Effect.fn("disconnectReceipt.begin")(function* begin(
    accountId: string
  ) {
    const now = yield* Clock.currentTimeMillis;
    yield* Effect.tryPromise({
      catch: () => failure("reserve"),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        database
          .prepare(`INSERT OR IGNORE INTO calendar_account_disconnect (person_id, account_id, phase, created_at)
SELECT owner.userId, owner.id, 'reserved', ? FROM account AS owner
WHERE owner.userId = ? AND owner.id = ? AND owner.providerId = 'google'
AND EXISTS (
  SELECT 1 FROM account AS remaining
  WHERE remaining.userId = owner.userId AND remaining.providerId = 'google' AND remaining.id <> owner.id
  AND NOT EXISTS (
    SELECT 1 FROM calendar_account_disconnect AS pending
    WHERE pending.person_id = remaining.userId AND pending.account_id = remaining.id AND pending.phase <> 'done'
  )
)`)
          .bind(now, personId, accountId)
          .run(),
    });

    const receipt = yield* load(accountId);

    if (receipt !== null) {
      return Reservation.cases.Reserved.make({ receipt });
    }

    const row: unknown = yield* Effect.tryPromise({
      catch: () => failure("ownership"),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        database
          .prepare(
            "SELECT id FROM account WHERE userId = ? AND id = ? AND providerId = 'google'"
          )
          .bind(personId, accountId)
          .first(),
    });

    const owned = yield* Schema.decodeUnknownEffect(
      Schema.NullOr(Schema.Struct({ id: Schema.String }))
    )(row).pipe(Effect.mapError(() => failure("ownership")));

    return owned === null
      ? Reservation.cases.NotOwned.make({})
      : Reservation.cases.LastAccount.make({});
  });

  const advance = Effect.fn("disconnectReceipt.advance")(function* advance(
    accountId: string,
    expected: typeof DisconnectPhase.Type,
    phase: typeof DisconnectPhase.Type
  ) {
    yield* Effect.tryPromise({
      catch: () => failure("advance"),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        database
          .prepare(
            "UPDATE calendar_account_disconnect SET phase = ? WHERE person_id = ? AND account_id = ? AND phase = ?"
          )
          .bind(phase, personId, accountId, expected)
          .run(),
    });
    const receipt = yield* load(accountId);

    if (receipt === null) {
      return yield* failure("missingReceipt");
    }

    if (receipt.phase === expected) {
      return yield* failure("advanceDidNotProgress");
    }

    return receipt;
  });

  const remove = Effect.fn("disconnectReceipt.remove")(function* remove(
    accountId: string
  ) {
    const gate =
      "EXISTS (SELECT 1 FROM calendar_account_disconnect WHERE person_id = ? AND account_id = ? AND phase = 'stopped')";

    const statements = [
      database
        .prepare(
          `DELETE FROM calendar_account_conferencing WHERE person_id = ? AND account_id = ? AND ${gate}`
        )
        .bind(personId, accountId, personId, accountId),
      database
        .prepare(
          `DELETE FROM calendar_range WHERE person_id = ? AND account_id = ? AND ${gate}`
        )
        .bind(personId, accountId, personId, accountId),
      database
        .prepare(
          `DELETE FROM calendar_snapshot WHERE person_id = ? AND account_id = ? AND ${gate}`
        )
        .bind(personId, accountId, personId, accountId),
      database
        .prepare(
          `DELETE FROM google_push_channel WHERE person_id = ? AND account_id = ? AND ${gate}`
        )
        .bind(personId, accountId, personId, accountId),
      database
        .prepare(
          `DELETE FROM account WHERE userId = ? AND id = ? AND providerId = 'google' AND ${gate}`
        )
        .bind(personId, accountId, personId, accountId),
      database
        .prepare(
          "UPDATE calendar_account_disconnect SET phase = 'removed' WHERE person_id = ? AND account_id = ? AND phase = 'stopped'"
        )
        .bind(personId, accountId),
    ];

    yield* Effect.tryPromise({
      catch: () => failure("remove"),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () => database.batch(statements),
    });
    const receipt = yield* load(accountId);

    if (receipt === null) {
      return yield* failure("missingReceipt");
    }

    if (receipt.phase !== "removed" && receipt.phase !== "done") {
      return yield* failure("removeDidNotProgress");
    }

    return receipt;
  });

  return { advance, begin, load, remove };
};

export type AccountDisconnectRepository = ReturnType<
  typeof accountDisconnectRepository
>;
