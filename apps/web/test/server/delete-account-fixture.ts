import { SessionSnapshot } from "@calendar/core/contracts";
import type { D1Database } from "@cloudflare/workers-types";
import { expect } from "@effect/vitest";
import { Cause, Clock, Effect, Layer, Queue, Schema } from "effect";

import { bundleCalendarWorkerArtifact } from "../../src/dev/bundle-worker.js";
import { DevelopmentRuntime } from "../../src/dev/native-runtime.js";
import type { CalendarEnvironment } from "../../src/server/calendar-environment.js";
import { calendarLiveClient } from "../../src/server/live-client.js";
import { unwatchableWindowMs } from "../../src/server/live-maintenance-state.js";
import { deletionObserver } from "./delete-account-socket.js";

export const deletionText = Schema.decodeUnknownSync(Schema.String);

const RpcRequest = Schema.TaggedStruct("Request", {
  headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
  id: Schema.String,
  payload: Schema.Json,
  tag: Schema.String,
});

const Row = Schema.Record(Schema.String, Schema.Json);

const Rows = Schema.Array(Row);

export const DeletionRows = Schema.Struct({
  account: Rows,
  calendar_account_conferencing: Rows,
  calendar_account_disconnect: Rows,
  calendar_range: Rows,
  calendar_snapshot: Rows,
  google_push_channel: Rows,
  google_push_unsupported: Rows,
  session: Rows,
  user: Rows,
  verification: Rows,
});

export const deletionTables = [
  "account",
  "calendar_account_conferencing",
  "calendar_account_disconnect",
  "calendar_range",
  "calendar_snapshot",
  "google_push_channel",
  "google_push_unsupported",
  "session",
  "user",
  "verification",
] as const;

export const deletionRows = Effect.fn("test.deletionRows")(
  function* deletionRows(database: D1Database) {
    const entries = yield* Effect.forEach(
      (table: (typeof deletionTables)[number]) => {
        const statement = database.prepare(
          `SELECT * FROM ${table} ORDER BY rowid`
        );

        return Effect.promise(statement.all.bind(statement)).pipe(
          Effect.map((result) => [table, result.results] as const)
        );
      }
    )(deletionTables);

    return yield* Schema.decodeUnknownEffect(DeletionRows)(
      Object.fromEntries(entries)
    );
  }
);

export const deletionNativeLayer = () =>
  Layer.unwrap(
    bundleCalendarWorkerArtifact(
      new URL("delete-account-native-worker.ts", import.meta.url).pathname
    ).pipe(
      Effect.map((artifact) =>
        DevelopmentRuntime.layer(
          "http://127.0.0.1:5173",
          ["joel@example.test"],
          "success",
          artifact
        )
      )
    )
  );

const SessionReply = Schema.Array(
  Schema.Struct({ exit: Schema.Struct({ value: SessionSnapshot }) })
);

const AccountId = Schema.Struct({ id: Schema.String });

export const accountDeletionFixture = Effect.gen(
  function* accountDeletionFixture() {
    const runtime = yield* DevelopmentRuntime;
    const first = runtime.person;
    const second = yield* runtime.seedPerson(["second@example.test"]);
    expect(second.personId).not.toBe(first.personId);

    const bindings = yield* Effect.tryPromise({
      catch: (cause) =>
        new Cause.UnknownError(cause, "Local deletion bindings failed"),
      // oxlint-disable-next-line typescript/promise-function-async -- The native method's optional worker name must not receive Effect's AbortSignal.
      try: () => runtime.miniflare.getBindings<CalendarEnvironment>(),
    });

    const live = calendarLiveClient(bindings.CALENDAR_LIVE);
    const firstVerificationIds = new Set<string>();
    const secondVerificationIds = new Set<string>();

    const execute = (
      sql: string,
      values: readonly (string | number | null)[] = []
    ) => {
      const statement = runtime.database.prepare(sql).bind(...values);

      return Effect.promise(statement.run.bind(statement));
    };

    const rpc = (method: string, input: Schema.Json, cookie = first.cookie) =>
      Effect.promise(
        runtime.handle.bind(
          runtime,
          new Request(`${runtime.origin}/rpc`, {
            body: JSON.stringify(
              RpcRequest.make({
                headers: [],
                id: "1",
                payload: input,
                tag: method,
              })
            ),
            headers: {
              "content-type": "application/json",
              cookie,
              origin: runtime.origin,
            },
            method: "POST",
          })
        )
      );

    const proofFor = Effect.fn("test.deletionProofFor")(function* proofFor(
      cookie: string,
      expectedPerson: string
    ) {
      const response = yield* rpc("session", {}, cookie);
      expect(response.status).toBe(200);
      const body: unknown = yield* Effect.promise(response.json.bind(response));
      const reply = yield* Schema.decodeUnknownEffect(SessionReply)(body);
      const snapshot = reply[0]?.exit.value;

      if (
        snapshot === undefined ||
        snapshot === null ||
        snapshot.accountDeletionProof === undefined
      ) {
        return yield* Effect.die(
          new Error("Deletion fixture lacks its real session confirmation")
        );
      }

      expect(snapshot.user.id).toBe(expectedPerson);

      return snapshot.accountDeletionProof;
    });

    const firstClosed = yield* Queue.unbounded<number>();
    const sockets = [];

    for (const person of [first, second]) {
      yield* live.reconcile(person.personId);

      const socket = yield* deletionObserver(
        runtime.url,
        person.cookie,
        runtime.origin,
        (code) => {
          if (person.personId === first.personId) {
            Queue.offerUnsafe(firstClosed, code);
          }
        }
      );

      sockets.push(socket);
      yield* live.reconcile(person.personId);
    }

    for (const { person, label } of [
      { label: "first", person: first },
      { label: "second", person: second },
    ]) {
      const statement = runtime.database
        .prepare(
          "SELECT id FROM account WHERE userId = ? AND providerId = 'google' AND disconnected = 0 LIMIT 1"
        )
        .bind(person.personId);

      const row: unknown = yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Local account fixture lookup failed"),
        // oxlint-disable-next-line typescript/promise-function-async -- D1 first's optional column argument must not receive Effect's AbortSignal.
        try: () => statement.first(),
      });

      const account = yield* Schema.decodeUnknownEffect(AccountId)(row);
      const retired = `${label}-retired-account`;
      yield* execute(
        'INSERT INTO session (id, "expiresAt", token, "createdAt", "updatedAt", "userId") VALUES (?, 9999999999999, ?, 1, 1, ?)',
        [
          `${label}-secondary-session`,
          `local-${label}-secondary-session`,
          person.personId,
        ]
      );
      yield* execute(
        'INSERT INTO account (id, "accountId", "providerId", "userId", "createdAt", "updatedAt", "googleEmail", disconnected) VALUES (?, ?, \'google\', ?, 1, 1, ?, 1)',
        [retired, retired, person.personId, `${label}@example.test`]
      );
      yield* execute(
        "INSERT INTO calendar_snapshot VALUES (?, ?, 'fixture-calendar', 1, 1, 'fixture-cursor')",
        [person.personId, retired]
      );
      yield* execute(
        "INSERT INTO calendar_range VALUES (?, ?, 'fixture-calendar', 1, '2026-01-01', '2026-01-08', 9999999999999, '[]')",
        [person.personId, retired]
      );
      yield* execute(
        "INSERT INTO google_push_unsupported VALUES (?, ?, 'fixture-calendar', 403, '[\"forbidden\"]', 1)",
        [person.personId, retired]
      );
      yield* execute(
        "INSERT INTO calendar_account_conferencing VALUES (?, ?, 'googleMeet')",
        [person.personId, account.id]
      );
      yield* execute(
        "INSERT INTO calendar_account_disconnect VALUES (?, ?, 'reserved', 1)",
        [person.personId, retired]
      );

      const records = [
        {
          id: `calendar-desktop:fixture-${label}`,
          value: JSON.stringify({
            personId: person.personId,
            sessionToken: `local-${label}`,
          }),
        },
        {
          id: `fixture-oauth-${label}`,
          value: JSON.stringify({
            callbackURL: "/",
            codeVerifier: "local-only",
            expiresAt: 9_999_999_999_999,
            link: { email: `${label}@example.test`, userId: person.personId },
            oauthState: `fixture-oauth-${label}`,
          }),
        },
        { id: `delete-account-fixture-${label}`, value: person.personId },
        { id: `reset-password:fixture-${label}`, value: person.personId },
      ];

      for (const record of records) {
        yield* execute(
          'INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES (?, ?, ?, 9999999999999, 1, 1)',
          [record.id, record.id, record.value]
        );

        if (person.personId === first.personId) {
          firstVerificationIds.add(record.id);
        } else {
          secondVerificationIds.add(record.id);
        }
      }

      const stub = bindings.CALENDAR_LIVE.getByName(person.personId);
      const due = (yield* Clock.currentTimeMillis) + unwatchableWindowMs;

      const seed = yield* Effect.promise(
        stub.fetch.bind(
          stub,
          "https://calendar.internal/__seed-delete-account",
          { headers: { "x-test-due-at": String(due) }, method: "POST" }
        )
      );

      expect(seed.status).toBe(200);
    }

    yield* execute(
      "INSERT INTO verification (id, identifier, value, \"expiresAt\", \"createdAt\", \"updatedAt\") VALUES ('unowned-verification', 'unowned-verification', 'not-json', 9999999999999, 1, 1)"
    );

    const inspect = (personId: string) => {
      const stub = bindings.CALENDAR_LIVE.getByName(personId);

      return Effect.promise(
        stub.fetch.bind(
          stub,
          "https://calendar.internal/__inspect-delete-account",
          undefined
        )
      ).pipe(
        Effect.flatMap((response) =>
          Effect.promise(response.json.bind(response))
        )
      );
    };

    const proof = yield* proofFor(first.cookie, first.personId);
    const secondProof = yield* proofFor(second.cookie, second.personId);

    return {
      bindings,
      execute,
      first,
      firstClosed,
      firstVerificationIds,
      input: { confirmation: "permanently-delete-my-account", proof },
      inspect,
      live,
      proof,
      proofFor,
      rpc,
      runtime,
      second,
      secondProof,
      secondVerificationIds,
      sockets,
    };
  }
);

export const expectedAfterFirstDeletion = (
  before: typeof DeletionRows.Type,
  personId: string,
  verificationIds: ReadonlySet<string>
) =>
  Object.fromEntries(
    deletionTables.map((table) => [
      table,
      before[table].filter((row) => {
        if (table === "verification") {
          return !verificationIds.has(deletionText(row.identifier));
        }

        return (
          row.person_id !== personId &&
          row.userId !== personId &&
          !(table === "user" && row.id === personId)
        );
      }),
    ])
  );
