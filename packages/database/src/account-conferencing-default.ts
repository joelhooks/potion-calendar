import type { D1Database } from "@cloudflare/workers-types";
import { Effect, Schema } from "effect";

import { AccountConferencingDefaultStoreError } from "./account-conferencing-default-error.js";

export { customVideoLinksRepository } from "./custom-video-links.js";

const StoredChoice = Schema.Literals(["unset", "none", "googleMeet"]);

const CustomChoice = Schema.Struct({
  id: Schema.NonEmptyString,
  kind: Schema.Literal("customLink"),
});

const Input = Schema.Struct({
  accountId: Schema.NonEmptyString,
  value: Schema.Union([StoredChoice, CustomChoice]),
});

const Row = Schema.Struct({
  accountId: Schema.NonEmptyString,
  activeLinkId: Schema.NullOr(Schema.NonEmptyString),
  customLinkId: Schema.NullOr(Schema.String),
  value: StoredChoice,
});

const failure = (operation: string) =>
  new AccountConferencingDefaultStoreError({ operation });

const activeOwner = `owner.userId = ? AND owner.id = ? AND owner.providerId = 'google'
AND NOT EXISTS (SELECT 1 FROM calendar_account_disconnect AS disconnected WHERE disconnected.person_id = owner.userId AND disconnected.account_id = owner.id)`;

const effectiveChoice = (
  row: typeof Row.Type
): typeof StoredChoice.Type | typeof CustomChoice.Type => {
  if (row.customLinkId === null) {
    return row.value;
  }

  if (row.activeLinkId === null) {
    return "none";
  }

  return CustomChoice.make({ id: row.activeLinkId, kind: "customLink" });
};

export const accountConferencingDefaultRepository = (
  database: D1Database,
  personId: string
) => {
  const get = Effect.fn("accountConferencingDefault.get")(function* get(
    accountId: string
  ) {
    yield* Schema.decodeEffect(Schema.NonEmptyString)(accountId).pipe(
      Effect.mapError(() => failure("invalidInput"))
    );

    const statement = database
      .prepare(`SELECT owner.id AS accountId, coalesce(preference.value, 'unset') AS value, custom.link_id AS customLinkId, link.id AS activeLinkId
FROM account AS owner LEFT JOIN calendar_account_conferencing AS preference ON preference.person_id = owner.userId AND preference.account_id = owner.id
LEFT JOIN calendar_account_custom_conferencing AS custom ON custom.person_id = owner.userId AND custom.account_id = owner.id
LEFT JOIN calendar_custom_video_links AS link ON link.person_id = custom.person_id AND link.id = custom.link_id AND link.state = 'active'
WHERE ${activeOwner}`)
      .bind(personId, accountId);

    const result = yield* Effect.tryPromise({
      catch: () => failure("get"),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () => database.batch([statement]),
    });

    const rows = yield* Schema.decodeUnknownEffect(Schema.Array(Row))(
      result[0]?.results
    ).pipe(Effect.mapError(() => failure("storedChoice")));

    const [row] = rows;

    if (row === undefined) {
      return null;
    }

    const value = effectiveChoice(row);

    return { accountId: row.accountId, value };
  });

  const set = Effect.fn("accountConferencingDefault.set")(function* set(
    input: typeof Input.Type
  ) {
    const valid = yield* Schema.decodeEffect(Input)(input).pipe(
      Effect.mapError(() => failure("invalidInput"))
    );

    const custom = Schema.is(CustomChoice)(valid.value)
      ? valid.value
      : undefined;

    const choice =
      custom === undefined
        ? yield* Schema.decodeUnknownEffect(StoredChoice)(valid.value).pipe(
            Effect.mapError(() => failure("invalidChoice"))
          )
        : "none";

    const activeLink =
      custom === undefined
        ? ""
        : " AND EXISTS (SELECT 1 FROM calendar_custom_video_links WHERE person_id = owner.userId AND id = ? AND state = 'active')";

    const main =
      database.prepare(`INSERT INTO calendar_account_conferencing (person_id, account_id, value)
SELECT owner.userId, owner.id, ? FROM account AS owner WHERE ${activeOwner}${activeLink}
ON CONFLICT (person_id, account_id) DO UPDATE SET value = excluded.value RETURNING account_id AS accountId, value`);

    const mainBound =
      custom === undefined
        ? main.bind(choice, personId, valid.accountId)
        : main.bind(choice, personId, valid.accountId, custom.id);

    const side =
      custom === undefined
        ? database
            .prepare(
              `DELETE FROM calendar_account_custom_conferencing WHERE person_id = ? AND account_id = ? AND EXISTS (SELECT 1 FROM account AS owner WHERE ${activeOwner})`
            )
            .bind(personId, valid.accountId, personId, valid.accountId)
        : database
            .prepare(`INSERT INTO calendar_account_custom_conferencing (person_id, account_id, link_id)
SELECT owner.userId, owner.id, ? FROM account AS owner WHERE ${activeOwner}${activeLink}
ON CONFLICT (person_id, account_id) DO UPDATE SET link_id = excluded.link_id`)
            .bind(custom.id, personId, valid.accountId, custom.id);

    const result = yield* Effect.tryPromise({
      catch: () => failure("unconfirmed"),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () => database.batch([mainBound, side]),
    });

    if (result[0]?.meta.changes !== 1) {
      return null;
    }

    return yield* get(valid.accountId);
  });

  return { get, set };
};
