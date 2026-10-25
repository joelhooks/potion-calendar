import { expect, layer } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { LiveCommand } from "../../src/server/live-protocol.js";
import { rpcValue } from "./calendar-rpc.js";
import {
  accountDeletionFixture,
  deletionNativeLayer,
  deletionRows,
  expectedAfterFirstDeletion,
} from "./delete-account-fixture.js";
import { nativeLiveCommand } from "./native-live-command.js";

const Cleanup = Schema.Struct({
  alarm: Schema.NullOr(Schema.Finite),
  counts: Schema.Struct({
    live_job: Schema.Int,
    live_message: Schema.Int,
    live_owner: Schema.Int,
    live_result: Schema.Int,
  }),
  inventory: Schema.Boolean,
});

layer(deletionNativeLayer(), { excludeTestServices: true })(
  "postcommit derived cleanup",
  (it) => {
    it.effect(
      "an actual owner SQL cleanup failure returns deletion success, schedules retry and never resurrects D1 rows",
      () =>
        Effect.gen(function* failedOwnerCleanup() {
          const fixture = yield* accountDeletionFixture;
          const { runtime, first, second, bindings } = fixture;
          const stub = bindings.CALENDAR_LIVE.getByName(first.personId);

          const installed = yield* Effect.promise(
            stub.fetch.bind(
              stub,
              "https://calendar.internal/__fail-delete-cleanup",
              { method: "POST" }
            )
          );

          expect(installed.status).toBe(200);
          const before = yield* deletionRows(runtime.database);
          const beta = yield* fixture.inspect(second.personId);
          const response = yield* fixture.rpc("deleteAccount", fixture.input);
          expect(response.status).toBe(200);

          const body: unknown = yield* Effect.promise(
            response.json.bind(response)
          );

          yield* Schema.decodeUnknownEffect(
            rpcValue(Schema.Struct({ deleted: Schema.Literal(true) }))
          )(body);
          expect(
            response.headers
              .getSetCookie()
              .some(
                (cookie) =>
                  cookie.includes("session_token=") &&
                  /max-age=0/iu.test(cookie)
              )
          ).toBe(true);

          const expected = expectedAfterFirstDeletion(
            before,
            first.personId,
            fixture.firstVerificationIds
          );

          expect(yield* deletionRows(runtime.database)).toEqual(expected);

          const pending = yield* fixture
            .inspect(first.personId)
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Cleanup)));

          expect(pending.counts.live_owner).toBe(1);
          expect(pending.alarm).not.toBeNull();
          expect(pending.inventory).toBe(false);

          const restored = yield* Effect.promise(
            stub.fetch.bind(
              stub,
              "https://calendar.internal/__restore-delete-cleanup",
              { method: "POST" }
            )
          );

          expect(restored.status).toBe(200);
          yield* nativeLiveCommand(
            bindings.CALENDAR_LIVE,
            LiveCommand.cases.DeleteAccount.make({ personId: first.personId })
          );
          expect(
            yield* fixture
              .inspect(first.personId)
              .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Cleanup)))
          ).toEqual({
            alarm: null,
            counts: {
              live_job: 0,
              live_message: 0,
              live_owner: 0,
              live_result: 0,
            },
            inventory: false,
          });
          expect(yield* fixture.inspect(second.personId)).toEqual(beta);
          expect(yield* deletionRows(runtime.database)).toEqual(expected);
        })
    );
  }
);
