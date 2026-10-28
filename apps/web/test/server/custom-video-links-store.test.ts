import {
  accountConferencingDefaultRepository,
  customVideoLinksRepository,
} from "@calendar/database/account-conferencing-default";
import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { expect, layer } from "@effect/vitest";
import { Cause, Context, Effect, Layer, Schema } from "effect";

import {
  authMigration,
  customVideoLinksMigration,
  d1Fixture,
  legacyConferencingMigration,
  makeD1Instance,
} from "./d1-fixture.js";

class CustomLinkDatabase extends Context.Service<
  CustomLinkDatabase,
  Effect.Success<typeof d1Fixture>
>()("test/CustomLinkDatabase") {}

const owner = "custom-links-owner";

const stranger = "custom-links-stranger";

const accountId = "custom-links-account";

const entry = {
  id: "room",
  link: "https://room.example/current",
  name: "Room",
};

const sql = (statement: D1PreparedStatement) =>
  Effect.tryPromise({
    catch: (cause) =>
      new Cause.UnknownError(cause, "Native custom-link SQL failed"),
    // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native D1 Promise adapter.
    try: () => statement.run(),
  });

const setup = Effect.fnUntraced(function* setup() {
  const database = yield* CustomLinkDatabase;

  for (const person of [owner, stranger]) {
    yield* sql(
      database.prepare('DELETE FROM "user" WHERE id = ?').bind(person)
    );
    yield* sql(
      database
        .prepare(
          'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, 0, 0)'
        )
        .bind(person, person, `${person}@example.test`)
    );
  }

  yield* sql(
    database
      .prepare(
        "INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt, disconnected) VALUES (?, ?, 'google', ?, 0, 0, 0)"
      )
      .bind(accountId, accountId, owner)
  );

  return {
    database,
    defaults: accountConferencingDefaultRepository(database, owner),
    links: customVideoLinksRepository(database, owner),
  };
});

const migrationProof = Effect.fnUntraced(function* migrationProof() {
  const miniflare = yield* Effect.acquireRelease(
    Effect.sync(makeD1Instance),
    (instance) => Effect.promise(instance.dispose.bind(instance))
  );

  const database = yield* Effect.promise(
    miniflare.getD1Database.bind(miniflare, "DB", undefined)
  );

  const batch = (statements: readonly D1PreparedStatement[]) =>
    Effect.tryPromise({
      catch: (cause) =>
        new Cause.UnknownError(cause, "Native migration batch failed"),
      try: database.batch.bind(database, [...statements]),
    });

  yield* batch(
    `${authMigration}\n${legacyConferencingMigration}`
      .split(";")
      .filter((statement) => statement.trim() !== "")
      .map((statement) => database.prepare(statement))
  );
  yield* sql(
    database
      .prepare(
        'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, 0, 0)'
      )
      .bind(owner, "Legacy", "legacy@example.test")
  );

  for (const value of Schema.Literals(["unset", "none", "googleMeet"])
    .literals) {
    yield* sql(
      database
        .prepare(
          "INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt, disconnected) VALUES (?, ?, 'google', ?, 0, 0, 0)"
        )
        .bind(value, value, owner)
    );
    yield* sql(
      database
        .prepare(
          "INSERT INTO calendar_account_conferencing (person_id, account_id, value) VALUES (?, ?, ?)"
        )
        .bind(owner, value, value)
    );
  }

  const snapshot = Effect.fnUntraced(function* snapshot() {
    const result = yield* batch([
      database.prepare(
        "SELECT person_id, account_id, value FROM calendar_account_conferencing ORDER BY account_id"
      ),
      database.prepare(
        "SELECT sql FROM sqlite_master WHERE name = 'calendar_account_conferencing'"
      ),
    ]);

    return {
      rows: yield* Schema.decodeUnknownEffect(
        Schema.Array(
          Schema.Struct({
            account_id: Schema.String,
            person_id: Schema.String,
            value: Schema.Literals(["unset", "none", "googleMeet"]),
          })
        )
      )(result[0]?.results),
      schema: yield* Schema.decodeUnknownEffect(
        Schema.Array(Schema.Struct({ sql: Schema.String }))
      )(result[1]?.results),
    };
  });

  const before = yield* snapshot();

  const additions = customVideoLinksMigration
    .split(";")
    .filter((statement) => statement.trim() !== "")
    .map((statement) => database.prepare(statement));

  const first = yield* Effect.fromNullishOr(additions[0]).pipe(Effect.orDie);
  yield* batch([
    first,
    database
      .prepare(
        'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, 0, 0)'
      )
      .bind(owner, "Duplicate", "duplicate@example.test"),
  ]).pipe(Effect.flip);

  const absent = yield* batch([
    database.prepare(
      "SELECT name FROM sqlite_master WHERE name = 'calendar_custom_video_links'"
    ),
  ]);

  expect(
    absent[0]?.results,
    "failed native migration must roll back its new table"
  ).toEqual([]);
  expect(yield* snapshot()).toEqual(before);
  yield* batch(additions);
  expect(
    yield* snapshot(),
    "additive migration must preserve the old schema and every old preference row"
  ).toEqual(before);
  expect(before.rows).toHaveLength(3);
});

const shadow = Effect.fnUntraced(function* shadow(
  database: Effect.Success<typeof d1Fixture>
) {
  const statement = database
    .prepare(
      "SELECT value FROM calendar_account_conferencing WHERE person_id = ? AND account_id = ?"
    )
    .bind(owner, accountId);

  const result: unknown = yield* Effect.tryPromise({
    catch: (cause) => new Cause.UnknownError(cause, "Old-schema read failed"),
    try: statement.first.bind(statement),
  });

  return yield* Schema.decodeUnknownEffect(
    Schema.Struct({ value: Schema.Literals(["unset", "none", "googleMeet"]) })
  )(result);
});

const failTrigger = Effect.fnUntraced(function* failTrigger(
  database: Effect.Success<typeof d1Fixture>,
  name: string,
  target: string,
  when = ""
) {
  yield* sql(
    database.prepare(
      `CREATE TRIGGER ${name} ${target} ${when} BEGIN SELECT RAISE(ABORT, 'p70 planted native failure'); END`
    )
  );
  yield* Effect.addFinalizer(() =>
    sql(database.prepare(`DROP TRIGGER ${name}`)).pipe(Effect.orDie)
  );
});

layer(Layer.effect(CustomLinkDatabase, d1Fixture))(
  "native custom-link catalog and account shadows",
  (it) => {
    it.effect(
      "native migration failure rolls back new tables and successful additive migration preserves all old values and schema bytes",
      () => migrationProof()
    );

    it.effect(
      "import keeps D1 conflicts and tombstones authoritative without partial prefixes",
      () =>
        Effect.gen(function* imports() {
          const { database, links } = yield* setup();
          expect((yield* links.importEntries([entry])).entries).toEqual([
            entry,
          ]);
          expect((yield* links.importEntries([entry])).conflicts).toEqual([]);

          const edited = {
            ...entry,
            link: "https://room.example/edited",
            name: "Edited",
          };

          yield* links.save({ ...edited, create: false });
          expect(yield* links.importEntries([entry])).toEqual({
            conflicts: [entry.id],
            entries: [edited],
          });
          yield* links.remove(entry.id);
          expect(yield* links.importEntries([entry])).toEqual({
            conflicts: [entry.id],
            entries: [],
          });
          expect(
            yield* links.save({ ...entry, create: true }).pipe(Effect.flip)
          ).toMatchObject({ operation: "missingOrConflictingLink" });
          yield* failTrigger(
            database,
            "p70_fail_import",
            "BEFORE INSERT ON calendar_custom_video_links",
            "WHEN NEW.id = 'z-fault'"
          );

          const input = [
            { ...entry, id: "a-prefix" },
            { ...entry, id: "z-fault" },
          ];

          yield* links.importEntries(input).pipe(Effect.flip);
          expect(
            (yield* links.list()).entries,
            "failed atomic import must leave no committed prefix"
          ).toEqual([]);
        })
    );
    it.effect(
      "custom choice is readable as none by the unchanged old-schema reader",
      () =>
        Effect.gen(function* oldReader() {
          const { database, links, defaults } = yield* setup();

          for (const value of Schema.Literals(["unset", "none", "googleMeet"])
            .literals) {
            expect(yield* defaults.set({ accountId, value })).toEqual({
              accountId,
              value,
            });
            expect(yield* shadow(database)).toEqual({ value });
          }

          yield* links.importEntries([entry]);
          expect(
            yield* defaults.set({
              accountId,
              value: { id: entry.id, kind: "customLink" },
            })
          ).toEqual({ accountId, value: { id: entry.id, kind: "customLink" } });
          expect(
            (yield* shadow(database)).value,
            "old-schema read of a custom-chosen account must decode as none"
          ).toBe("none");
          yield* links.save({
            ...entry,
            create: false,
            link: "https://room.example/edited",
          });
          expect((yield* links.get(entry.id)).link).toBe(
            "https://room.example/edited"
          );
          expect((yield* defaults.get(accountId))?.value).toEqual({
            id: entry.id,
            kind: "customLink",
          });
          yield* links.remove(entry.id);
          expect(
            (yield* defaults.get(accountId))?.value,
            "removal must retain explicit none rather than inherit"
          ).toBe("none");
          expect(yield* shadow(database)).toEqual({ value: "none" });

          for (const value of Schema.Literals(["unset", "none", "googleMeet"])
            .literals) {
            yield* defaults.set({ accountId, value });
            expect((yield* defaults.get(accountId))?.value).toBe(value);
          }
        })
    );
    it.effect(
      "invalid side references cannot fall through to a legacy Meet choice",
      () =>
        Effect.gen(function* invalidSide() {
          const { database, links, defaults } = yield* setup();
          yield* links.importEntries([entry]);
          yield* defaults.set({
            accountId,
            value: { id: entry.id, kind: "customLink" },
          });
          yield* sql(
            database
              .prepare(
                "UPDATE calendar_account_conferencing SET value = 'googleMeet' WHERE person_id = ? AND account_id = ?"
              )
              .bind(owner, accountId)
          );
          yield* sql(
            database
              .prepare(
                "UPDATE calendar_custom_video_links SET state = 'removed' WHERE person_id = ? AND id = ?"
              )
              .bind(owner, entry.id)
          );
          expect(
            (yield* defaults.get(accountId))?.value,
            "invalid side reference must resolve to none, never Meet"
          ).toBe("none");
          expect(yield* links.get(entry.id).pipe(Effect.flip)).toMatchObject({
            operation: "missingLink",
          });
        })
    );
    it.effect(
      "person fences apply to catalog reads, edits, removals and account references",
      () =>
        Effect.gen(function* isolation() {
          const { database, links, defaults } = yield* setup();
          yield* links.importEntries([entry]);
          const foreign = customVideoLinksRepository(database, stranger);
          expect(
            (yield* foreign.list()).entries,
            "another person's catalog must not be returned"
          ).toEqual([]);
          yield* foreign
            .save({ ...entry, create: false, name: "Foreign" })
            .pipe(Effect.flip);
          yield* foreign.remove(entry.id);
          expect(
            (yield* links.list()).entries,
            "another person's catalog must not change"
          ).toEqual([entry]);
          expect(
            yield* accountConferencingDefaultRepository(database, stranger).set(
              { accountId, value: { id: entry.id, kind: "customLink" } }
            )
          ).toBeNull();
          expect((yield* defaults.get(accountId))?.value).toBe("unset");
        })
    );
    it.effect(
      "a native failure after the main shadow write rolls back both choice tables",
      () =>
        Effect.gen(function* atomicChoice() {
          const { database, links, defaults } = yield* setup();
          yield* links.importEntries([entry]);
          yield* defaults.set({ accountId, value: "googleMeet" });
          yield* failTrigger(
            database,
            "p70_fail_side",
            "BEFORE INSERT ON calendar_account_custom_conferencing"
          );
          yield* defaults
            .set({ accountId, value: { id: entry.id, kind: "customLink" } })
            .pipe(Effect.flip);
          expect((yield* defaults.get(accountId))?.value).toBe("googleMeet");
          expect(yield* shadow(database)).toEqual({ value: "googleMeet" });
        })
    );
    it.effect(
      "a native failure deleting references rolls back the catalog tombstone",
      () =>
        Effect.gen(function* atomicRemoval() {
          const { database, links, defaults } = yield* setup();
          yield* links.importEntries([entry]);
          yield* defaults.set({
            accountId,
            value: { id: entry.id, kind: "customLink" },
          });
          yield* failTrigger(
            database,
            "p70_fail_remove",
            "BEFORE DELETE ON calendar_account_custom_conferencing"
          );
          yield* links.remove(entry.id).pipe(Effect.flip);
          expect(yield* links.get(entry.id)).toEqual(entry);
          expect((yield* defaults.get(accountId))?.value).toEqual({
            id: entry.id,
            kind: "customLink",
          });
          expect(yield* shadow(database)).toEqual({ value: "none" });
        })
    );
  }
);
