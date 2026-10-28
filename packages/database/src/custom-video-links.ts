import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";
import { Effect, Option, Schema } from "effect";

import { CustomVideoLinksStoreError } from "./custom-video-links-error.js";

const Url = Schema.URLFromString.check(
  Schema.makeFilter(
    (url) => url.protocol === "https:" || url.protocol === "http:"
  )
);

const Entry = Schema.Struct({
  id: Schema.NonEmptyString,
  link: Schema.String.check(
    Schema.makeFilter((value) => Option.isSome(Schema.decodeOption(Url)(value)))
  ),
  name: Schema.String.check(
    Schema.makeFilter((value) => value.trim().length > 0)
  ),
});

const Entries = Schema.Array(Entry).check(
  Schema.makeFilter(
    (entries) =>
      new Set(entries.map((entry) => entry.id)).size === entries.length
  )
);

const Save = Schema.Struct({ ...Entry.fields, create: Schema.Boolean });

const Removed = Schema.Struct({ id: Schema.NonEmptyString });

const failure = (operation: string) =>
  new CustomVideoLinksStoreError({ operation });

export const customVideoLinksRepository = (
  database: D1Database,
  personId: string
) => {
  const listStatement = () =>
    database
      .prepare(
        "SELECT id, name, link FROM calendar_custom_video_links WHERE person_id = ? AND state = 'active' ORDER BY rowid"
      )
      .bind(personId);

  const batch = Effect.fn("customVideoLinks.batch")(function* batch(
    statements: readonly D1PreparedStatement[]
  ) {
    return yield* Effect.tryPromise({
      catch: () => failure("unconfirmed"),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () => database.batch([...statements]),
    });
  });

  const list = Effect.fn("customVideoLinks.list")(function* list() {
    const result = yield* batch([listStatement()]);

    const entries = yield* Schema.decodeUnknownEffect(Entries)(
      result[0]?.results
    ).pipe(Effect.mapError(() => failure("storedEntry")));

    return { conflicts: [], entries };
  });

  const get = Effect.fn("customVideoLinks.get")(function* get(id: string) {
    const valid = yield* Schema.decodeEffect(Schema.NonEmptyString)(id).pipe(
      Effect.mapError(() => failure("invalidInput"))
    );

    const result = yield* batch([
      database
        .prepare(
          "SELECT id, name, link FROM calendar_custom_video_links WHERE person_id = ? AND id = ? AND state = 'active'"
        )
        .bind(personId, valid),
    ]);

    const entries = yield* Schema.decodeUnknownEffect(Entries)(
      result[0]?.results
    ).pipe(Effect.mapError(() => failure("storedEntry")));

    if (entries[0] === undefined) {
      return yield* failure("missingLink");
    }

    return entries[0];
  });

  const importEntries = Effect.fn("customVideoLinks.import")(
    function* importEntries(input: readonly (typeof Entry.Type)[]) {
      const valid = yield* Schema.decodeEffect(Entries)(input).pipe(
        Effect.mapError(() => failure("invalidInput"))
      );

      const encoded = JSON.stringify(valid);

      const results = yield* batch([
        database
          .prepare(`INSERT INTO calendar_custom_video_links (person_id, id, name, link, state)
SELECT ?, json_extract(value, '$.id'), json_extract(value, '$.name'), json_extract(value, '$.link'), 'active'
FROM json_each(?) WHERE true ON CONFLICT (person_id, id) DO NOTHING`)
          .bind(personId, encoded),
        listStatement(),
        database
          .prepare(`SELECT saved.id FROM calendar_custom_video_links AS saved JOIN json_each(?) AS source ON saved.id = json_extract(source.value, '$.id')
WHERE saved.person_id = ? AND (saved.state != 'active' OR saved.name != json_extract(source.value, '$.name') OR saved.link != json_extract(source.value, '$.link')) ORDER BY saved.id`)
          .bind(encoded, personId),
      ]);

      const entries = yield* Schema.decodeUnknownEffect(Entries)(
        results[1]?.results
      ).pipe(Effect.mapError(() => failure("storedEntry")));

      const conflicts = yield* Schema.decodeUnknownEffect(
        Schema.Array(Removed)
      )(results[2]?.results).pipe(
        Effect.mapError(() => failure("storedConflict"))
      );

      return { conflicts: conflicts.map((entry) => entry.id), entries };
    }
  );

  const save = Effect.fn("customVideoLinks.save")(function* save(
    input: typeof Save.Type
  ) {
    const valid = yield* Schema.decodeEffect(Save)(input).pipe(
      Effect.mapError(() => failure("invalidInput"))
    );

    const result = yield* batch([
      database
        .prepare(`INSERT INTO calendar_custom_video_links (person_id, id, name, link, state)
SELECT ?, ?, ?, ?, 'active' WHERE ? = 1 OR EXISTS (SELECT 1 FROM calendar_custom_video_links WHERE person_id = ? AND id = ? AND state = 'active')
ON CONFLICT (person_id, id) DO UPDATE SET name = excluded.name, link = excluded.link
WHERE calendar_custom_video_links.state = 'active' AND (? = 0 OR (calendar_custom_video_links.name = excluded.name AND calendar_custom_video_links.link = excluded.link))
RETURNING id`)
        .bind(
          personId,
          valid.id,
          valid.name,
          valid.link,
          Number(valid.create),
          personId,
          valid.id,
          Number(valid.create)
        ),
    ]);

    const written = yield* Schema.decodeUnknownEffect(Schema.Array(Removed))(
      result[0]?.results
    ).pipe(Effect.mapError(() => failure("storedWrite")));

    if (written.length !== 1) {
      return yield* failure("missingOrConflictingLink");
    }

    return yield* list();
  });

  const remove = Effect.fn("customVideoLinks.remove")(function* remove(
    id: string
  ) {
    const valid = yield* Schema.decodeEffect(Schema.NonEmptyString)(id).pipe(
      Effect.mapError(() => failure("invalidInput"))
    );

    yield* batch([
      database
        .prepare(
          "UPDATE calendar_custom_video_links SET state = 'removed' WHERE person_id = ? AND id = ?"
        )
        .bind(personId, valid),
      database
        .prepare(
          "DELETE FROM calendar_account_custom_conferencing WHERE person_id = ? AND link_id = ?"
        )
        .bind(personId, valid),
    ]);

    return yield* list();
  });

  return { get, importEntries, list, remove, save };
};
