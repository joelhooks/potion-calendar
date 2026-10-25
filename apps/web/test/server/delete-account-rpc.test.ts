import {
  AccountDeletionRefused,
  AccountDeletionUnavailable,
  SessionSnapshot,
} from "@calendar/core/contracts";
import { layer, expect } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";

import { LiveCommand } from "../../src/server/live-protocol.js";
import { rpcFailure, rpcValue } from "./calendar-rpc.js";
import {
  accountDeletionFixture,
  deletionNativeLayer,
  deletionRows,
  deletionTables,
  deletionText,
  expectedAfterFirstDeletion,
} from "./delete-account-fixture.js";
import { nativeLiveCommand } from "./native-live-command.js";

const Deleted = Schema.Struct({ deleted: Schema.Literal(true) });

const Failed = Schema.NonEmptyArray(
  Schema.Struct({ exit: Schema.TaggedStruct("Failure", {}) })
);

const Inspection = Schema.Struct({
  alarm: Schema.NullOr(Schema.Finite),
  cooldowns: Schema.Int,
  counts: Schema.Struct({
    live_job: Schema.Int,
    live_message: Schema.Int,
    live_owner: Schema.Int,
    live_result: Schema.Int,
  }),
  inventory: Schema.Boolean,
  sockets: Schema.Array(Schema.Int),
});

const document = Effect.fn("test.accountDeletionDocument")(
  function* deletionDocument(response: Response) {
    const body: unknown = yield* Effect.promise(response.json.bind(response));

    return body;
  }
);

layer(deletionNativeLayer(), { excludeTestServices: true })(
  "native account deletion",
  (it) => {
    it.effect(
      "the real authenticated RPC removes all ten A families, stops only A channels, clears A's owner and cookie, and preserves B",
      () =>
        Effect.gen(function* deleteFirstPerson() {
          const fixture = yield* accountDeletionFixture;
          const { runtime, first, second, bindings } = fixture;
          const beforeIssue = yield* deletionRows(runtime.database);

          const previousIdentifiers = new Set(
            beforeIssue.verification.map((row) => deletionText(row.identifier))
          );

          const issued = yield* Effect.promise(
            runtime.handle.bind(
              runtime,
              new Request(
                `${runtime.origin}/desktop/sign-in?port=49152&state=${"d".repeat(64)}`,
                {
                  headers: { cookie: first.cookie, origin: runtime.origin },
                  method: "POST",
                }
              )
            )
          );

          expect(issued.status).toBe(303);

          const handoff = new URL(
            issued.headers.get("location") ?? runtime.origin
          ).searchParams.get("token");

          expect(handoff).toMatch(/^[a-f0-9]{64}$/u);
          const afterIssue = yield* deletionRows(runtime.database);

          const added = afterIssue.verification.filter(
            (row) => !previousIdentifiers.has(deletionText(row.identifier))
          );

          expect(added).toHaveLength(1);

          for (const row of added) {
            expect(deletionText(row.identifier)).toMatch(/^calendar-desktop:/u);
            fixture.firstVerificationIds.add(deletionText(row.identifier));
          }

          const before = yield* deletionRows(runtime.database);

          for (const [person, identifiers] of [
            [first, fixture.firstVerificationIds],
            [second, fixture.secondVerificationIds],
          ] as const) {
            for (const table of deletionTables) {
              const owned = before[table].filter((row) =>
                table === "verification"
                  ? identifiers.has(deletionText(row.identifier))
                  : row.person_id === person.personId ||
                    row.userId === person.personId ||
                    (table === "user" && row.id === person.personId)
              );

              expect(
                owned.length,
                `${table} contains the seeded person's rows`
              ).toBeGreaterThan(0);
            }
          }

          expect(
            before.session.filter((row) => row.userId === first.personId).length
          ).toBeGreaterThanOrEqual(2);
          expect(
            before.account.filter((row) => row.userId === first.personId).length
          ).toBeGreaterThanOrEqual(2);

          const beforeOther = yield* fixture
            .inspect(second.personId)
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Inspection)));

          const beforeOwner = yield* fixture
            .inspect(first.personId)
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Inspection)));

          expect(beforeOwner.sockets).toEqual([1]);
          expect(fixture.sockets.map((socket) => socket.readyState)).toEqual([
            1, 1,
          ]);
          expect(beforeOwner.counts.live_owner).toBe(1);
          expect(beforeOwner.inventory).toBe(true);
          expect(beforeOwner.counts.live_result).toBeGreaterThan(0);
          expect(beforeOwner.counts.live_job).toBeGreaterThan(0);
          expect(beforeOwner.counts.live_message).toBeGreaterThan(0);
          expect(beforeOwner.cooldowns).toBeGreaterThan(0);
          expect(beforeOwner.alarm).not.toBeNull();

          const ownedChannels = before.google_push_channel.filter(
            (row) => row.person_id === first.personId && row.state !== "stopped"
          );

          expect(ownedChannels.length).toBeGreaterThan(0);
          const outboundStart = runtime.outboundRequests.length;
          const response = yield* fixture.rpc("deleteAccount", fixture.input);
          expect(response.status).toBe(200);
          yield* document(response).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(rpcValue(Deleted)))
          );
          expect(
            response.headers
              .getSetCookie()
              .some(
                (cookie) =>
                  cookie.includes("session_token=") &&
                  /max-age=0/iu.test(cookie)
              )
          ).toBe(true);
          expect(yield* deletionRows(runtime.database)).toEqual(
            expectedAfterFirstDeletion(
              before,
              first.personId,
              fixture.firstVerificationIds
            )
          );
          expect(
            runtime.channelStops.map((stop) => stop.id).toSorted()
          ).toEqual(
            ownedChannels.map((row) => deletionText(row.id)).toSorted()
          );
          expect(
            runtime.channelStops.every(
              (stop) => stop.email === "joel@example.test"
            )
          ).toBe(true);
          expect(
            runtime.outboundRequests
              .slice(outboundStart)
              .every((request) => request.path === "/calendar/v3/channels/stop")
          ).toBe(true);
          expect([2, 3]).toContain(fixture.sockets[0]?.readyState);
          expect(fixture.sockets[1]?.readyState).toBe(1);

          const afterOwner = yield* fixture
            .inspect(first.personId)
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Inspection)));

          expect(afterOwner).toMatchObject({
            alarm: null,
            cooldowns: 0,
            counts: {
              live_job: 0,
              live_message: 0,
              live_owner: 0,
              live_result: 0,
            },
            inventory: false,
          });
          expect(afterOwner.sockets).not.toContain(1);
          expect(
            yield* fixture
              .inspect(second.personId)
              .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Inspection)))
          ).toEqual(beforeOther);

          yield* nativeLiveCommand(
            bindings.CALENDAR_LIVE,
            LiveCommand.cases.DeleteAccount.make({ personId: first.personId })
          );

          const repeated = yield* fixture
            .inspect(first.personId)
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Inspection)));

          expect(repeated).toMatchObject({
            alarm: null,
            cooldowns: 0,
            counts: {
              live_job: 0,
              live_message: 0,
              live_owner: 0,
              live_result: 0,
            },
            inventory: false,
          });
          expect(repeated.sockets).not.toContain(1);
          const betaSession = yield* fixture.rpc("session", {}, second.cookie);
          expect(betaSession.status).toBe(200);
          expect(betaSession.headers.getSetCookie()).toEqual([]);

          const beta = yield* document(betaSession).pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(rpcValue(SessionSnapshot))
            )
          );

          expect(beta[0].exit.value?.user.id).toBe(second.personId);

          const target = before.google_push_channel.find(
            (row) => row.person_id === second.personId && row.kind === "events"
          );

          if (target === undefined) {
            return yield* Effect.die(
              new Error("The other person lacks a live sync target")
            );
          }

          const ref = {
            accountId: deletionText(target.account_id),
            calendarId: deletionText(target.calendar_id),
          };

          expect(
            (yield* fixture.live.synchronize(second.personId, ref)).version
          ).toBeGreaterThan(0);
          expect(
            Result.isFailure(
              yield* fixture.live
                .synchronize(first.personId, ref)
                .pipe(Effect.result)
            )
          ).toBe(true);
          expect(
            yield* fixture
              .inspect(first.personId)
              .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Inspection)))
          ).toMatchObject({
            counts: {
              live_job: 0,
              live_message: 0,
              live_owner: 0,
              live_result: 0,
            },
            inventory: false,
          });

          const redeemed = yield* Effect.promise(
            runtime.handle.bind(
              runtime,
              new Request(
                `${runtime.origin}/desktop/complete?token=${handoff ?? ""}`
              )
            )
          );

          expect(redeemed.status).toBe(400);
          expect(redeemed.headers.getSetCookie()).toEqual([]);
          expect(yield* Effect.promise(redeemed.text.bind(redeemed))).toContain(
            "Sign-in failed"
          );

          const statement = runtime.database.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY name"
          );

          const tableResult = yield* Effect.promise(
            statement.all.bind(statement)
          );

          const tables = yield* Schema.decodeUnknownEffect(
            Schema.Array(Schema.Struct({ name: Schema.String }))
          )(tableResult.results);

          expect(tables.map((table) => table.name)).toEqual(
            [...deletionTables].toSorted()
          );

          return yield* Effect.void;
        })
    );
  }
);

layer(deletionNativeLayer(), { excludeTestServices: true })(
  "refused deletion admission",
  (it) => {
    it.effect(
      "missing authentication and every selected-user field are refused without deletes, channel stops or cookies",
      () =>
        Effect.gen(function* refusedDeletion() {
          const fixture = yield* accountDeletionFixture;
          const before = yield* deletionRows(fixture.runtime.database);

          const missing = yield* fixture.rpc(
            "deleteAccount",
            fixture.input,
            ""
          );

          expect(missing.status).toBe(409);
          yield* document(missing).pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(rpcFailure(AccountDeletionRefused))
            )
          );
          expect(missing.headers.getSetCookie()).toEqual([]);

          for (const key of [
            "id",
            "personId",
            "userId",
            "ownerId",
            "accountId",
            "arbitraryTarget",
          ]) {
            const response = yield* fixture.rpc("deleteAccount", {
              ...fixture.input,
              [key]: fixture.second.personId,
            });

            yield* document(response).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Failed))
            );
            expect(response.headers.getSetCookie()).toEqual([]);
            expect(yield* deletionRows(fixture.runtime.database)).toEqual(
              before
            );
          }

          expect(fixture.runtime.channelStops).toEqual([]);
          const response = yield* fixture.rpc("deleteAccount", fixture.input);
          yield* document(response).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(rpcValue(Deleted)))
          );
        })
    );
  }
);

layer(deletionNativeLayer(), { excludeTestServices: true })(
  "session-switch deletion fence",
  (it) => {
    it.effect(
      "A's confirmation arriving under B's cookie returns 409 and changes neither user's rows",
      () =>
        Effect.gen(function* switchedCookie() {
          const fixture = yield* accountDeletionFixture;
          expect(fixture.proof).not.toBe(fixture.secondProof);
          const before = yield* deletionRows(fixture.runtime.database);

          const response = yield* fixture.rpc(
            "deleteAccount",
            fixture.input,
            fixture.second.cookie
          );

          expect(response.status).toBe(409);
          yield* document(response).pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(rpcFailure(AccountDeletionRefused))
            )
          );
          expect(response.headers.getSetCookie()).toEqual([]);
          expect(yield* deletionRows(fixture.runtime.database)).toEqual(before);
          expect(fixture.runtime.channelStops).toEqual([]);
          const next = yield* fixture.rpc("session", {}, fixture.second.cookie);
          expect(next.status).toBe(200);
          expect(next.headers.getSetCookie()).toEqual([]);

          const beta = yield* document(next).pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(rpcValue(SessionSnapshot))
            )
          );

          expect(beta[0].exit.value?.user.id).toBe(fixture.second.personId);
          expect(yield* deletionRows(fixture.runtime.database)).toEqual(before);
        })
    );
  }
);

layer(deletionNativeLayer(), { excludeTestServices: true })(
  "best-effort deletion channel stops",
  (it) => {
    it.effect(
      "a failed A stop leaves only that provider channel alive while local deletion succeeds and its genuine push cannot resolve",
      () =>
        Effect.gen(function* failedChannelStop() {
          const fixture = yield* accountDeletionFixture;
          const before = yield* deletionRows(fixture.runtime.database);

          const first = before.google_push_channel.find(
            (row) =>
              row.person_id === fixture.first.personId &&
              row.kind === "calendarList"
          );

          if (first === undefined) {
            return yield* Effect.die(
              new Error("Deletion fixture lacks its calendar-list watch")
            );
          }

          const id = deletionText(first.id);
          expect(yield* fixture.runtime.notifyChannel(id)).toBe(200);
          yield* fixture.live.reconcile(fixture.first.personId);
          yield* fixture.runtime.refuseChannelStop(id);
          const prepared = yield* deletionRows(fixture.runtime.database);
          const stopStart = fixture.runtime.channelStops.length;
          const response = yield* fixture.rpc("deleteAccount", fixture.input);
          yield* document(response).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(rpcValue(Deleted)))
          );
          const remaining = fixture.runtime.providerChannels();
          expect(
            remaining
              .filter((channel) => channel.email === "joel@example.test")
              .map((channel) => channel.id)
          ).toEqual([id]);
          expect(
            remaining
              .filter((channel) => channel.email === "second@example.test")
              .map((channel) => channel.id)
              .toSorted()
          ).toEqual(
            before.google_push_channel
              .filter((row) => row.person_id === fixture.second.personId)
              .map((row) => deletionText(row.id))
              .toSorted()
          );
          expect(
            [
              ...new Set(
                fixture.runtime.channelStops
                  .slice(stopStart)
                  .map((stop) => stop.id)
              ),
            ].toSorted()
          ).toEqual(
            prepared.google_push_channel
              .filter(
                (row) =>
                  row.person_id === fixture.first.personId &&
                  row.state !== "stopped"
              )
              .map((row) => deletionText(row.id))
              .toSorted()
          );
          expect(yield* fixture.runtime.notifyChannel(id)).toBe(404);
          const after = yield* deletionRows(fixture.runtime.database);
          expect(after).toEqual(
            expectedAfterFirstDeletion(
              before,
              fixture.first.personId,
              fixture.firstVerificationIds
            )
          );
          expect(
            yield* fixture
              .inspect(fixture.first.personId)
              .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Inspection)))
          ).toMatchObject({
            counts: {
              live_job: 0,
              live_message: 0,
              live_owner: 0,
              live_result: 0,
            },
          });

          return yield* Effect.void;
        })
    );
  }
);

layer(deletionNativeLayer(), { excludeTestServices: true })(
  "atomic deletion rollback",
  (it) => {
    it.effect(
      "a final-statement failure restores every family, leaves the session signed in, and releases live admission",
      () =>
        Effect.gen(function* rollbackDeletion() {
          const fixture = yield* accountDeletionFixture;
          yield* fixture.execute(
            "CREATE TRIGGER refuse_delete BEFORE DELETE ON user BEGIN SELECT RAISE(ABORT, 'local deletion rollback'); END"
          );
          yield* fixture.execute(
            "UPDATE account SET accessTokenExpiresAt = '1970-01-01T00:00:01.000Z' WHERE userId = ?",
            [fixture.first.personId]
          );
          expect(
            yield* fixture.proofFor(
              fixture.first.cookie,
              fixture.first.personId
            )
          ).toBe(fixture.proof);
          const before = yield* deletionRows(fixture.runtime.database);
          const outboundStart = fixture.runtime.outboundRequests.length;
          const response = yield* fixture.rpc("deleteAccount", fixture.input);
          yield* document(response).pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(rpcFailure(AccountDeletionUnavailable))
            )
          );
          expect(response.headers.getSetCookie()).toEqual([]);
          expect(yield* deletionRows(fixture.runtime.database)).toEqual(before);
          expect(fixture.runtime.outboundRequests.slice(outboundStart)).toEqual(
            []
          );

          const channel = before.google_push_channel.find(
            (row) =>
              row.person_id === fixture.first.personId && row.kind === "events"
          );

          if (channel === undefined) {
            return yield* Effect.die(
              new Error("Deletion fixture lacks a normal sync target")
            );
          }

          const result = yield* fixture.live.synchronize(
            fixture.first.personId,
            {
              accountId: deletionText(channel.account_id),
              calendarId: deletionText(channel.calendar_id),
            }
          );

          expect(result.version).toBeGreaterThan(0);
          expect(
            yield* fixture.proofFor(
              fixture.first.cookie,
              fixture.first.personId
            )
          ).toBe(fixture.proof);
          expect(
            fixture.runtime.outboundRequests
              .slice(outboundStart)
              .some((request) => request.path.endsWith("/token"))
          ).toBe(true);
          yield* fixture.execute("DROP TRIGGER refuse_delete");
          const retried = yield* fixture.rpc("deleteAccount", fixture.input);
          yield* document(retried).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(rpcValue(Deleted)))
          );
          expect(yield* deletionRows(fixture.runtime.database)).toEqual(
            expectedAfterFirstDeletion(
              before,
              fixture.first.personId,
              fixture.firstVerificationIds
            )
          );

          return yield* Effect.void;
        })
    );
  }
);
