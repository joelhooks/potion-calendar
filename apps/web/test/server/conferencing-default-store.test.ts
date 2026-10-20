import { accountConferencingDefaultRepository } from "@calendar/database/account-conferencing-default";
import { accountDisconnectRepository } from "@calendar/database/account-disconnect";
import { expect, layer } from "@effect/vitest";
import { Cause, Context, Effect, Layer, Schema } from "effect";

import { d1Fixture } from "./d1-fixture.js";

class ConferencingDatabase extends Context.Service<
  ConferencingDatabase,
  Effect.Success<typeof d1Fixture>
>()("test/ConferencingDatabase") {}

layer(Layer.effect(ConferencingDatabase, d1Fixture))(
  "D1 conferencing reservation fence",
  (it) => {
    it.effect.prop(
      "a preference write racing reservation cannot survive forgetting or repopulate an old connection id",
      {
        reverse: Schema.Boolean,
        value: Schema.Literals(["none", "googleMeet", "unset"]),
      },
      ({ reverse, value }) =>
        Effect.gen(function* conferencingProof() {
          const database = yield* ConferencingDatabase;
          const personId = "conferencing-race-person";
          const accountId = "conferencing-race-account";

          const batch = [
            database
              .prepare(
                "DELETE FROM calendar_account_conferencing WHERE person_id = ?"
              )
              .bind(personId),
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
              .bind(personId, "Race", "conferencing-race@example.test"),
            ...[accountId, "conferencing-race-survivor"].map((id) =>
              database
                .prepare(
                  "INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt, disconnected) VALUES (?, ?, 'google', ?, 0, 0, 0)"
                )
                .bind(id, id, personId)
            ),
          ];

          yield* Effect.tryPromise({
            catch: (cause) =>
              new Cause.UnknownError(cause, "Conferencing race setup failed"),
            // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
            try: () => database.batch(batch),
          });

          const preference = accountConferencingDefaultRepository(
            database,
            personId
          );

          const disconnect = accountDisconnectRepository(database, personId);
          const write = preference.set({ accountId, value });
          const reserve = disconnect.begin(accountId);
          yield* Effect.all(reverse ? [reserve, write] : [write, reserve], {
            concurrency: "unbounded",
          });
          expect(yield* disconnect.load(accountId)).toMatchObject({
            phase: "reserved",
          });
          expect(
            yield* preference.set({ accountId, value: "googleMeet" })
          ).toBeNull();
          yield* disconnect.advance(accountId, "reserved", "stopped");
          yield* disconnect.remove(accountId);
          yield* disconnect.advance(accountId, "removed", "done");
          expect(yield* preference.set({ accountId, value })).toBeNull();
          expect(yield* preference.get(accountId)).toBeNull();

          const row: unknown = yield* Effect.tryPromise({
            catch: (cause) =>
              new Cause.UnknownError(
                cause,
                "Conferencing race verification failed"
              ),
            // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
            try: () =>
              database
                .prepare(
                  "SELECT count(*) AS count FROM calendar_account_conferencing WHERE person_id = ? AND account_id = ?"
                )
                .bind(personId, accountId)
                .first(),
          });

          expect(
            yield* Schema.decodeUnknownEffect(
              Schema.Struct({ count: Schema.Int })
            )(row)
          ).toEqual({ count: 0 });
        }),
      { arbitrary: { runs: 20 }, timeout: 15_000 }
    );
  }
);
