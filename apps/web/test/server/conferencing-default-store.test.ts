import { accountConferencingDefaultRepository } from "@calendar/database/account-conferencing-default";
import { accountDisconnectRepository } from "@calendar/database/account-disconnect";
import { expect, layer } from "@effect/vitest";
import { Cause, Context, Effect, Layer, Schema } from "effect";

import { d1Fixture } from "./d1-fixture.js";

class ConferencingDatabase extends Context.Service<
  ConferencingDatabase,
  Effect.Success<typeof d1Fixture>
>()("test/ConferencingDatabase") {}

const Preference = Schema.Literals(["none", "googleMeet", "unset"]);

const conferencingFixture = Effect.fnUntraced(function* conferencingFixture() {
  const database = yield* ConferencingDatabase;
  const personId = "conferencing-race-person";
  const accountId = "conferencing-race-account";

  const batch = [
    database
      .prepare("DELETE FROM calendar_account_conferencing WHERE person_id = ?")
      .bind(personId),
    database
      .prepare("DELETE FROM calendar_account_disconnect WHERE person_id = ?")
      .bind(personId),
    database.prepare("DELETE FROM account WHERE userId = ?").bind(personId),
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

  return {
    accountId,
    database,
    disconnect: accountDisconnectRepository(database, personId),
    personId,
    preference: accountConferencingDefaultRepository(database, personId),
  };
});

const preferenceRace = Effect.fnUntraced(function* preferenceRace(input: {
  readonly reverse: boolean;
  readonly value: typeof Preference.Type;
}) {
  const { accountId, disconnect, preference } = yield* conferencingFixture();
  const write = preference.set({ accountId, value: input.value });
  const reserve = disconnect.begin(accountId);

  yield* Effect.all(input.reverse ? [reserve, write] : [write, reserve], {
    concurrency: "unbounded",
  });

  expect(yield* disconnect.load(accountId)).toMatchObject({
    phase: "reserved",
  });
  expect(yield* preference.set({ accountId, value: input.value })).toBeNull();
  expect(yield* preference.get(accountId)).toBeNull();
});

layer(Layer.effect(ConferencingDatabase, d1Fixture))(
  "D1 conferencing reservation fence",
  (it) => {
    it.effect(
      "every preference and native request order remains fenced after reservation",
      () =>
        Effect.gen(function* preferenceRaceMatrix() {
          for (const value of Preference.literals) {
            for (const reverse of [false, true]) {
              yield* preferenceRace({ reverse, value });
            }
          }
        }),
      15_000
    );

    it.effect(
      "forgetting removes an existing native preference and refuses foreign and stale writes",
      () =>
        Effect.gen(function* forgetPreference() {
          const { accountId, database, disconnect, personId, preference } =
            yield* conferencingFixture();

          expect(
            yield* accountConferencingDefaultRepository(
              database,
              "foreign-person"
            ).set({ accountId, value: "googleMeet" })
          ).toBeNull();
          expect(
            yield* preference.set({ accountId, value: "googleMeet" })
          ).toEqual({ accountId, value: "googleMeet" });
          expect(yield* preference.get(accountId)).toEqual({
            accountId,
            value: "googleMeet",
          });

          yield* disconnect.begin(accountId);
          expect(yield* disconnect.load(accountId)).toMatchObject({
            phase: "reserved",
          });
          expect(
            yield* preference.set({ accountId, value: "googleMeet" })
          ).toBeNull();
          expect(yield* preference.get(accountId)).toBeNull();
          yield* disconnect.advance(accountId, "reserved", "stopped");
          yield* disconnect.remove(accountId);
          yield* disconnect.advance(accountId, "removed", "done");

          for (const value of Preference.literals) {
            expect(yield* preference.set({ accountId, value })).toBeNull();
          }

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
      15_000
    );
  }
);
