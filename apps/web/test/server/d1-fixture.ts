// @effect-diagnostics-next-line nodeBuiltinImport:off -- The D1 fixture loads the checked-in calendar migration.
import { readFileSync } from "node:fs";

import { Effect } from "effect";
import { Miniflare } from "miniflare";

export const calendarMigration = readFileSync(
  new URL(
    "../../../../packages/database/migrations/calendar/0002_calendar_cache.sql",
    import.meta.url
  ),
  "utf-8"
);

export const makeD1Instance = () =>
  new Miniflare({
    compatibilityDate: "2026-07-30",
    d1Databases: { DB: "calendar-test" },
    modules: true,
    script: "export default { fetch() { return new Response('fixture'); } };",
  });

export const d1Fixture = Effect.gen(function* d1Fixture() {
  const miniflare = yield* Effect.acquireRelease(
    Effect.sync(makeD1Instance),
    (instance) => Effect.promise(instance.dispose.bind(instance))
  );

  const database = yield* Effect.promise(
    miniflare.getD1Database.bind(miniflare, "DB", undefined)
  );

  const statements = calendarMigration
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => database.prepare(statement));

  yield* Effect.promise(database.batch.bind(database, statements));

  return database;
});
