import { Provider } from "@calendar/calendar";
import {
  accountDisconnectRepository,
  Reservation,
} from "@calendar/database/account-disconnect";
import { expect, layer } from "@effect/vitest";
import { Cause, Context, Effect, Layer, Ref, Result, Schema } from "effect";
import { TestClock } from "effect/testing";

import { disconnectOwnedAccount } from "../../src/server/account-disconnect.js";
import { d1Fixture } from "./d1-fixture.js";

class ReservationDatabase extends Context.Service<
  ReservationDatabase,
  Effect.Success<typeof d1Fixture>
>()("test/ReservationDatabase") {}

layer(Layer.effect(ReservationDatabase, d1Fixture))(
  "durable disconnect reservations",
  (it) => {
    it.effect(
      "notification failure resumes an owned deleted account without repeating channel stop",
      () =>
        Effect.gen(function* resumeRemovedAccount() {
          const database = yield* ReservationDatabase;
          const personId = "notification-person";
          const accountId = "notification-account-0";

          const statements = [
            database
              .prepare(
                'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, 0, 0)'
              )
              .bind(personId, "Notification", "notification@example.test"),
            ...[accountId, "notification-account-1"].map((id) =>
              database
                .prepare(
                  "INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt, googleEmail, disconnected) VALUES (?, ?, 'google', ?, 0, 0, ?, 0)"
                )
                .bind(id, id, personId, `${id}@example.test`)
            ),
          ];

          yield* Effect.tryPromise({
            catch: (cause) =>
              new Cause.UnknownError(
                cause,
                "Notification recovery setup failed"
              ),
            // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
            try: () => database.batch(statements),
          });
          const repository = accountDisconnectRepository(database, personId);
          const stops = yield* Ref.make(0);
          const notices = yield* Ref.make(0);

          const effects = {
            notify: () =>
              Ref.getAndUpdate(notices, (count) => count + 1).pipe(
                Effect.flatMap((previous) =>
                  previous === 0
                    ? Effect.fail(
                        new Provider({
                          message: "Fixture live owner unavailable",
                          operation: "notify",
                          status: 0,
                        })
                      )
                    : Effect.void
                )
              ),
            stop: () => Ref.update(stops, (count) => count + 1),
          };

          const failed = yield* disconnectOwnedAccount(
            repository,
            effects,
            accountId
          ).pipe(Effect.result);

          expect(Result.isFailure(failed)).toBe(true);
          expect(yield* repository.load(accountId)).toMatchObject({
            phase: "removed",
          });

          const row: unknown = yield* Effect.tryPromise({
            catch: (cause) =>
              new Cause.UnknownError(
                cause,
                "Deleted account verification failed"
              ),
            // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
            try: () =>
              database
                .prepare("SELECT id FROM account WHERE id = ?")
                .bind(accountId)
                .first(),
          });

          expect(row).toBeNull();
          expect(
            (yield* disconnectOwnedAccount(repository, effects, accountId))
              .revocation
          ).toBe("notAttempted");
          expect(yield* repository.load(accountId)).toMatchObject({
            phase: "done",
          });
          yield* disconnectOwnedAccount(repository, effects, accountId);
          expect(yield* Ref.get(stops)).toBe(1);
          expect(yield* Ref.get(notices)).toBe(2);
        })
    );

    const reservationHistory = Effect.fnUntraced(
      function* reservationHistory(input: {
        readonly count: number;
        readonly reverse: boolean;
      }) {
        const { count, reverse } = input;
        const database = yield* ReservationDatabase;
        const personId = "reservation-property";

        const ids = Array.from(
          { length: count },
          (_, index) => `reservation-account-${index}`
        );

        const statements = [
          database
            .prepare(
              "DELETE FROM calendar_account_disconnect WHERE person_id = ?"
            )
            .bind(personId),
          database
            .prepare("DELETE FROM account WHERE userId = ?")
            .bind(personId),
          database
            .prepare(
              'INSERT OR IGNORE INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, 0, 0)'
            )
            .bind(personId, "Reservation", "reservation@example.test"),
          ...ids.map((id) =>
            database
              .prepare(
                "INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt, googleEmail, disconnected) VALUES (?, ?, 'google', ?, 0, 0, ?, 0)"
              )
              .bind(id, id, personId, `${id}@example.test`)
          ),
        ];

        yield* Effect.tryPromise({
          catch: (cause) =>
            new Cause.UnknownError(cause, "Reservation history setup failed"),
          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () => database.batch(statements),
        });
        const repository = accountDisconnectRepository(database, personId);
        const foreign = accountDisconnectRepository(database, "foreign-person");

        expect(yield* foreign.begin(ids[0] ?? "")).toEqual(
          Reservation.cases.NotOwned.make({})
        );
        expect(yield* repository.load(ids[0] ?? "")).toBeNull();

        const order = reverse ? ids.toReversed() : ids;

        const outcomes = yield* Effect.forEach(order, repository.begin, {
          concurrency: count,
        });

        const reserved = outcomes.filter(Reservation.guards.Reserved);
        expect(reserved).toHaveLength(count - 1);
        expect(outcomes.filter(Reservation.guards.LastAccount)).toHaveLength(1);
        expect(outcomes.filter(Reservation.guards.NotOwned)).toHaveLength(0);

        for (const [index, outcome] of outcomes.entries()) {
          if (Reservation.guards.Reserved(outcome)) {
            expect(outcome.receipt).toMatchObject({
              accountId: order[index],
              personId,
              phase: "reserved",
            });
          }
        }

        const [first] = reserved;

        if (first === undefined) {
          throw new Error("No reservation was admitted");
        }

        yield* TestClock.adjust(1);
        expect(yield* repository.begin(first.receipt.accountId)).toEqual(first);

        const row: unknown = yield* Effect.tryPromise({
          catch: (cause) =>
            new Cause.UnknownError(cause, "Reservation survivor query failed"),
          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () =>
            database
              .prepare(
                "SELECT (SELECT count(*) FROM account WHERE userId = ?) AS accounts, (SELECT count(*) FROM calendar_account_disconnect WHERE person_id = ?) AS receipts, (SELECT count(*) FROM account AS linked WHERE linked.userId = ? AND NOT EXISTS (SELECT 1 FROM calendar_account_disconnect WHERE person_id = linked.userId AND account_id = linked.id AND phase <> 'done')) AS available"
              )
              .bind(personId, personId, personId)
              .first(),
        });

        const remaining = yield* Schema.decodeUnknownEffect(
          Schema.Struct({
            accounts: Schema.Int,
            available: Schema.Int,
            receipts: Schema.Int,
          })
        )(row);

        expect(remaining).toEqual({
          accounts: count,
          available: 1,
          receipts: count - 1,
        });

        expect(yield* foreign.begin(first.receipt.accountId)).toEqual(
          Reservation.cases.NotOwned.make({})
        );
      }
    );

    it.effect(
      "native minimum and maximum account races preserve owned idempotent receipts",
      () =>
        Effect.gen(function* reservationBoundaries() {
          for (const input of [
            { count: 2, reverse: false },
            { count: 8, reverse: true },
          ]) {
            yield* reservationHistory(input);
          }
        }),
      15_000
    );

    it.effect.prop(
      "generated concurrent reservations retain one unreserved account and owned receipts",
      {
        count: Schema.Int.check(Schema.isBetween({ maximum: 8, minimum: 2 })),
        reverse: Schema.Boolean,
      },
      reservationHistory,
      { arbitrary: { runs: 3 }, timeout: 15_000 }
    );
  }
);
