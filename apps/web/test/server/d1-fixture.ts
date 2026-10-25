// @effect-diagnostics-next-line nodeBuiltinImport:off -- The D1 fixture loads the checked-in calendar migration.
import { readFileSync } from "node:fs";

import type {
  D1Database,
  DurableObjectNamespace,
} from "@cloudflare/workers-types";
import { Cause, Effect } from "effect";
import { Miniflare } from "miniflare";

export const calendarMigration = readFileSync(
  new URL(
    "../../../../packages/database/migrations/calendar/0002_calendar_cache.sql",
    import.meta.url
  ),
  "utf-8"
);

export const authMigration = readFileSync(
  new URL(
    "../../../../packages/database/migrations/calendar/0001_auth.sql",
    import.meta.url
  ),
  "utf-8"
);

export const pushMigration = readFileSync(
  new URL(
    "../../../../packages/database/migrations/calendar/0003_google_push.sql",
    import.meta.url
  ),
  "utf-8"
);

export const settingsMigration = readFileSync(
  new URL(
    "../../../../packages/database/migrations/calendar/0004_settings_disconnect.sql",
    import.meta.url
  ),
  "utf-8"
);

export const conferencingMigration = readFileSync(
  new URL(
    "../../../../packages/database/migrations/calendar/0006_conferencing_default.sql",
    import.meta.url
  ),
  "utf-8"
);

export const unsupportedPushMigration = readFileSync(
  new URL(
    "../../../../packages/database/migrations/calendar/0007_push_unsupported.sql",
    import.meta.url
  ),
  "utf-8"
);

export const settingsFenceMigration = readFileSync(
  new URL(
    "../../../../packages/database/migrations/calendar/0005_settings_disconnect_fences.sql",
    import.meta.url
  ),
  "utf-8"
);

export const verificationOwnerMigration = readFileSync(
  new URL(
    "../../../../packages/database/migrations/calendar/0008_verification_owner_fence.sql",
    import.meta.url
  ),
  "utf-8"
);

export const primaryAccountMigration = readFileSync(
  new URL(
    "../../../../packages/database/migrations/calendar/0009_primary_calendar_account.sql",
    import.meta.url
  ),
  "utf-8"
);

export const makeD1Instance = () =>
  new Miniflare({
    compatibilityDate: "2026-07-30",
    d1Databases: { DB: "calendar-test" },
    durableObjects: {
      CALENDAR_LIVE: { className: "FixtureLive", useSQLite: true },
    },
    modules: true,
    script:
      "export class FixtureLive { fetch() { return new Response('fixture', {status: 501}); } } export default { fetch() { return new Response('fixture'); } };",
  });

export const liveNamespaceFixture = Effect.gen(
  function* liveNamespaceFixture() {
    const miniflare = yield* Effect.acquireRelease(
      Effect.sync(makeD1Instance),
      (instance) => Effect.promise(instance.dispose.bind(instance))
    );

    const bindings = yield* Effect.tryPromise({
      catch: (cause) =>
        new Cause.UnknownError(cause, "Native Promise adapter failed"),

      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        miniflare.getBindings<{ CALENDAR_LIVE: DurableObjectNamespace }>(),
    }).pipe(Effect.orDie);

    return bindings.CALENDAR_LIVE;
  }
);

export const seedCalendarCacheOwners = Effect.fn(
  "test.seedCalendarCacheOwners"
)(function* seedCalendarCacheOwners(
  database: D1Database,
  people: readonly string[]
) {
  const statements = people.map((personId) =>
    database
      .prepare(
        "INSERT INTO user (id, name, email, \"emailVerified\", \"createdAt\", \"updatedAt\") VALUES (?, 'Cache owner', ?, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')"
      )
      .bind(personId, `${personId}@cache.example.test`)
  );

  yield* Effect.promise(database.batch.bind(database, statements));
});

export const d1Fixture = Effect.gen(function* d1Fixture() {
  const miniflare = yield* Effect.acquireRelease(
    Effect.sync(makeD1Instance),
    (instance) => Effect.promise(instance.dispose.bind(instance))
  );

  const database = yield* Effect.promise(
    miniflare.getD1Database.bind(miniflare, "DB", undefined)
  );

  const statements = [
    ...[
      authMigration,
      calendarMigration,
      pushMigration,
      settingsMigration,
      conferencingMigration,
      unsupportedPushMigration,
      primaryAccountMigration,
    ]
      .join("\n")
      .split(";"),
    ...settingsFenceMigration.split("\n"),
    ...verificationOwnerMigration.split("\n"),
  ].flatMap((statement) => {
    const sql = statement.trim();

    return sql === "" ? [] : [database.prepare(sql)];
  });

  yield* Effect.promise(database.batch.bind(database, statements));

  return database;
});
