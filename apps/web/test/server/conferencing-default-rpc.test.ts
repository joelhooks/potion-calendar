import {
  AccountConferencingDefault,
  AccountConferencingDefaultFailure,
  DisconnectAccountResult,
  DisconnectAccountFailure,
  ListCalendarsOutput,
} from "@calendar/calendar/contracts";
import { accountConferencingDefaultRepository } from "@calendar/database/account-conferencing-default";
import { expect, layer } from "@effect/vitest";
import { Cause, Context, Effect, Layer, Schema } from "effect";

import { DevelopmentRuntime } from "../../src/dev/native-runtime.js";
import { settingsRpcFixture } from "./settings-rpc-fixture.js";

class ConferencingRpc extends Context.Service<
  ConferencingRpc,
  Effect.Success<typeof settingsRpcFixture>
>()("test/ConferencingRpc") {}

const fixtureLayer = (emails?: readonly string[]) =>
  Layer.effect(ConferencingRpc, settingsRpcFixture).pipe(
    Layer.provide(DevelopmentRuntime.layer("http://127.0.0.1:5173", emails))
  );

layer(fixtureLayer(["joel@example.test"]), { excludeTestServices: true })(
  "account conferencing preference RPC",
  (it) => {
    it.effect(
      "a missing row is unset, explicit choices persist, and genuinely foreign and unknown connection ids cannot write",
      () =>
        Effect.gen(function* conferencingProof() {
          const fixture = yield* ConferencingRpc;
          const { accountId } = fixture.target;

          const read = () =>
            fixture.success(
              "getAccountConferencingDefault",
              { accountId },
              AccountConferencingDefault
            );

          expect(yield* read()).toEqual({ accountId, value: "unset" });

          const store = accountConferencingDefaultRepository(
            fixture.runtime.database,
            fixture.runtime.person.personId
          );

          for (const value of ["none", "googleMeet", "unset"] as const) {
            expect(
              yield* fixture.success(
                "setAccountConferencingDefault",
                { accountId, value },
                AccountConferencingDefault
              )
            ).toEqual({ accountId, value });
            expect(yield* read()).toEqual({ accountId, value });
            expect(yield* store.get(accountId)).toEqual({ accountId, value });
          }

          const foreign = yield* fixture.runtime.seedPerson([
            "second@example.test",
          ]);

          expect(foreign.personId).not.toBe(fixture.runtime.person.personId);

          const foreignListing = yield* fixture.success(
            "listCalendars",
            {},
            ListCalendarsOutput,
            new Headers({ cookie: foreign.cookie, origin: fixture.origin })
          );

          const foreignId = yield* Effect.fromNullishOr(
            foreignListing.accounts[0]?.accountId
          ).pipe(Effect.orDie);

          for (const refusedId of [foreignId, "unknown-connection"]) {
            for (const method of [
              "getAccountConferencingDefault",
              "setAccountConferencingDefault",
            ]) {
              const error = yield* fixture.failure(
                method,
                { accountId: refusedId, value: "googleMeet" },
                AccountConferencingDefaultFailure
              );

              expect(error._tag).toBe("AccountNotOwned");
              expect(error).toMatchObject({ accountId: refusedId });
            }

            expect(yield* store.get(refusedId)).toBeNull();
          }

          const foreignStore = accountConferencingDefaultRepository(
            fixture.runtime.database,
            foreign.personId
          );

          expect(yield* foreignStore.get(foreignId)).toEqual({
            accountId: foreignId,
            value: "unset",
          });
        })
    );
  }
);

layer(fixtureLayer(), { excludeTestServices: true })(
  "conferencing preference forget and relink",
  (it) => {
    it.effect(
      "disconnect removes the preference transactionally, replay preserves forgetting, and relinking the same Google identity starts unset on a fresh id",
      () =>
        Effect.gen(function* conferencingProof() {
          const fixture = yield* ConferencingRpc;
          const { accountId, calendarId } = fixture.target;

          const other = yield* Effect.fromNullishOr(
            fixture.calendars.find(
              (calendar) => calendar.accountId !== accountId
            )
          ).pipe(Effect.orDie);

          expect(
            yield* fixture.success(
              "getAccountConferencingDefault",
              { accountId: other.accountId },
              AccountConferencingDefault
            )
          ).toEqual({ accountId: other.accountId, value: "unset" });
          yield* fixture.success(
            "setAccountConferencingDefault",
            { accountId: other.accountId, value: "none" },
            AccountConferencingDefault
          );
          yield* fixture.success(
            "setAccountConferencingDefault",
            { accountId, value: "googleMeet" },
            AccountConferencingDefault
          );
          expect(
            yield* fixture.success(
              "getAccountConferencingDefault",
              { accountId: other.accountId },
              AccountConferencingDefault
            )
          ).toEqual({ accountId: other.accountId, value: "none" });
          yield* fixture.execute(
            `CREATE TRIGGER conferencing_forget_rollback BEFORE DELETE ON account WHEN OLD.id = '${accountId.replaceAll("'", "''")}' BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END`
          );

          const failed = yield* fixture.failure(
            "disconnectAccount",
            { accountId },
            DisconnectAccountFailure
          );

          expect(failed._tag).toBe("Provider");

          const rows = yield* Effect.tryPromise({
            catch: (cause) =>
              new Cause.UnknownError(cause, "Preference lookup failed"),
            // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
            try: () =>
              fixture.runtime.database
                .prepare(
                  "SELECT value FROM calendar_account_conferencing WHERE person_id = ? AND account_id = ?"
                )
                .bind(fixture.runtime.person.personId, accountId)
                .first(),
          }).pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.Struct({ value: Schema.Literal("googleMeet") })
              )
            )
          );

          expect(rows.value).toBe("googleMeet");
          yield* fixture.execute("DROP TRIGGER conferencing_forget_rollback");
          yield* fixture.success(
            "disconnectAccount",
            { accountId },
            DisconnectAccountResult
          );
          yield* fixture.success(
            "disconnectAccount",
            { accountId },
            DisconnectAccountResult
          );

          const refused = yield* fixture.failure(
            "setAccountConferencingDefault",
            { accountId, value: "googleMeet" },
            AccountConferencingDefaultFailure
          );

          expect(refused._tag).toBe("AccountNotOwned");
          expect(refused).toMatchObject({ accountId });

          const count: unknown = yield* Effect.tryPromise({
            catch: (cause) =>
              new Cause.UnknownError(cause, "Preference count failed"),
            // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
            try: () =>
              fixture.runtime.database
                .prepare(
                  "SELECT count(*) AS count FROM calendar_account_conferencing WHERE account_id = ?"
                )
                .bind(accountId)
                .first(),
          });

          expect(
            yield* Schema.decodeUnknownEffect(
              Schema.Struct({ count: Schema.Int })
            )(count)
          ).toEqual({ count: 0 });

          const relinked = yield* fixture.runtime.linkAccount(
            calendarId,
            fixture.runtime.person.cookie
          );

          const relisted = yield* fixture.success(
            "listCalendars",
            {},
            ListCalendarsOutput,
            new Headers({ cookie: relinked.cookie, origin: fixture.origin })
          );

          const fresh = yield* Effect.fromNullishOr(
            relisted.accounts
              .flatMap((account) =>
                "calendars" in account ? account.calendars : []
              )
              .find((calendar) => calendar.calendarId === calendarId)
          ).pipe(Effect.orDie);

          expect(fresh.accountId).not.toBe(accountId);
          expect(
            yield* fixture.success(
              "getAccountConferencingDefault",
              { accountId: fresh.accountId },
              AccountConferencingDefault,
              new Headers({ cookie: relinked.cookie, origin: fixture.origin })
            )
          ).toEqual({ accountId: fresh.accountId, value: "unset" });
        })
    );
  }
);
