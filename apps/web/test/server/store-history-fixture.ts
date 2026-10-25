import { Clock, Context, Effect, Layer, Schema } from "effect";
import { Miniflare } from "miniflare";

import {
  StoreHistoryInputJson,
  StoreObservationsJson,
} from "../../../../packages/calendar/test/store-history.js";
import type { StoreCommandValue } from "../../../../packages/calendar/test/store-history.js";
import { bundleCalendarWorker } from "../../src/dev/bundle-worker.js";
import { d1CalendarStore } from "../../src/server/calendar-store.js";
import {
  authMigration,
  calendarMigration,
  seedCalendarCacheOwners,
} from "./d1-fixture.js";

const makeStoreHistoryFixture = Effect.gen(function* makeStoreHistoryFixture() {
  const entry = new URL("store-history-worker.ts", import.meta.url).pathname;
  const modules = yield* bundleCalendarWorker(entry);

  const instance = yield* Effect.acquireRelease(
    Effect.sync(
      () =>
        new Miniflare({
          compatibilityDate: "2026-07-30",
          d1Databases: { DB: "calendar-test" },
          host: "127.0.0.1",
          modules,
          modulesRoot: "/calendar",
          outboundService: () =>
            new Response("Outbound network is disabled", { status: 503 }),
        })
    ),
    (current) => Effect.promise(current.dispose.bind(current))
  );

  const database = yield* Effect.promise(
    instance.getD1Database.bind(instance, "DB", undefined)
  );

  const statements = [authMigration, calendarMigration]
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => database.prepare(statement));

  yield* Effect.promise(database.batch.bind(database, statements));
  yield* seedCalendarCacheOwners(database, ["person"]);

  const store = Layer.unwrap(
    Effect.gen(function* isolatedStore() {
      yield* Effect.promise(
        database.batch.bind(database, [
          database.prepare("DELETE FROM calendar_range"),
          database.prepare("DELETE FROM calendar_snapshot"),
        ])
      );

      return d1CalendarStore(database, "person");
    })
  );

  const run = Effect.fn("test.nativeStoreHistory")(function* run(
    commands: readonly StoreCommandValue[]
  ) {
    const body = yield* Schema.encodeEffect(StoreHistoryInputJson)({
      clockMilliseconds: yield* Clock.currentTimeMillis,
      commands,
    });

    const response = yield* Effect.promise(
      instance.dispatchFetch.bind(
        instance,
        "http://fixture.test/__store-contract-history",
        { body, method: "POST" }
      )
    );

    const text = yield* Effect.promise(response.text.bind(response));

    if (response.status !== 200) {
      return yield* Effect.die(
        new Error(`Native store history failed (${response.status}): ${text}`)
      );
    }

    return yield* Schema.decodeEffect(StoreObservationsJson)(text);
  });

  return { database, run, store };
});

export class StoreHistoryFixture extends Context.Service<
  StoreHistoryFixture,
  Effect.Success<typeof makeStoreHistoryFixture>
>()("test/StoreHistoryFixture") {
  static readonly layer = Layer.effect(
    StoreHistoryFixture,
    makeStoreHistoryFixture
  );
}

export const nativeHistoryStore = Layer.unwrap(
  StoreHistoryFixture.use((fixture) => Effect.succeed(fixture.store))
);

export const runNativeStoreHistory = Effect.fn("test.runNativeStoreHistory")(
  function* runNativeStoreHistory(commands: readonly StoreCommandValue[]) {
    const fixture = yield* StoreHistoryFixture;

    return yield* fixture.run(commands);
  }
);
