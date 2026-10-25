import type { D1Database } from "@cloudflare/workers-types";
import { DateTime, Effect, Schema } from "effect";

export class ProfileStoreError extends Schema.TaggedError<ProfileStoreError>()(
  "ProfileStoreError",
  { operation: Schema.String }
) {}

const Input = Schema.Struct({
  name: Schema.NonEmptyString,
  primaryAccountId: Schema.optionalKey(Schema.NonEmptyString),
  sessionId: Schema.NonEmptyString,
  sessionToken: Schema.NonEmptyString,
});

const Row = Schema.Struct({
  name: Schema.String,
  primaryAccountId: Schema.NullOr(Schema.String),
});

export const profileRepository = (
  database: D1Database,
  personId: string,
  allowedEmails: string
) => ({
  save: Effect.fn("profile.save")(function* save(input: typeof Input.Type) {
    const valid = yield* Schema.decodeEffect(Input)(input).pipe(
      Effect.mapError(
        () => new ProfileStoreError({ operation: "invalidInput" })
      )
    );

    yield* Schema.decodeEffect(Schema.NonEmptyString)(personId).pipe(
      Effect.mapError(
        () => new ProfileStoreError({ operation: "invalidOwner" })
      )
    );

    const now = DateTime.formatIso(yield* DateTime.now);
    const primary = valid.primaryAccountId ?? null;

    const row: unknown = yield* Effect.tryPromise({
      catch: () => new ProfileStoreError({ operation: "save" }),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        database
          .prepare(`UPDATE "user" SET name = ?, "updatedAt" = ?,
        "primaryCalendarAccountId" = CASE WHEN ? IS NULL THEN "primaryCalendarAccountId" ELSE ? END
        WHERE id = ?
        AND EXISTS (SELECT 1 FROM "session" AS active WHERE active.id = ? AND active.token = ? AND active."userId" = "user".id AND julianday(active."expiresAt") > julianday(?))
        AND (? IS NULL OR EXISTS (
          SELECT 1 FROM account AS owner WHERE owner.id = ? AND owner."userId" = "user".id
          AND owner."providerId" = 'google' AND coalesce(owner.disconnected, 0) = 0
          AND owner."googleEmail" IN (SELECT value FROM json_each(?))
          AND NOT EXISTS (SELECT 1 FROM calendar_account_disconnect AS disconnected WHERE disconnected.person_id = owner."userId" AND disconnected.account_id = owner.id)
        ))
        RETURNING name, "primaryCalendarAccountId" AS primaryAccountId`)
          .bind(
            valid.name,
            now,
            primary,
            primary,
            personId,
            valid.sessionId,
            valid.sessionToken,
            now,
            primary,
            primary,
            JSON.stringify(
              allowedEmails
                .split(",")
                .map((email) => email.trim().toLowerCase())
                .filter(Boolean)
            )
          )
          .first(),
    });

    return yield* Schema.decodeUnknownEffect(Schema.NullOr(Row))(row).pipe(
      Effect.mapError(
        () => new ProfileStoreError({ operation: "storedProfile" })
      )
    );
  }),
});
