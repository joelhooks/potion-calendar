import type { D1Database } from "@cloudflare/workers-types";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";

import { GooglePushStoreError } from "./google-push-error.js";
import type { PushResourceValue } from "./google-push.js";
import { GooglePushUnsupported } from "./schema/google-push.js";

const Key = {
  accountId: Schema.NonEmptyString,
  calendarId: Schema.NonEmptyString,
  personId: Schema.NonEmptyString,
};

const Reasons = Schema.Array(
  Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9_.-]{0,95}$/u))
).check(Schema.isMinLength(1));

const Observation = {
  observedAt: Schema.Int,
  status: Schema.Literals([400, 403]),
};

const Unsupported = Schema.Struct({
  ...Key,
  ...Observation,
  reasonCodes: Reasons,
});

const StoredUnsupported = Schema.Struct({
  ...Key,
  ...Observation,
  reasonCodes: Schema.fromJsonString(Reasons),
});

const failure = (
  operation: string,
  reason: "input" | "storage" | "storedRow"
) => new GooglePushStoreError({ operation, reason });

export const pushUnsupportedRepository = (binding: D1Database) => {
  const database = drizzle(binding);

  const unsupported = Effect.fn("googlePush.unsupported")(function* unsupported(
    personId: string,
    resource: PushResourceValue
  ) {
    if (resource.kind !== "events") {
      return null;
    }

    const key = yield* Schema.decodeEffect(Schema.Struct(Key))({
      accountId: resource.accountId,
      calendarId: resource.calendarId,
      personId,
    }).pipe(Effect.mapError(() => failure("unsupported", "input")));

    const rows = yield* Effect.tryPromise({
      catch: () => failure("unsupported", "storage"),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        database
          .select()
          .from(GooglePushUnsupported)
          .where(
            and(
              eq(GooglePushUnsupported.personId, key.personId),
              eq(GooglePushUnsupported.accountId, key.accountId),
              eq(GooglePushUnsupported.calendarId, key.calendarId)
            )
          )
          .limit(1)
          .all(),
    });

    const decoded = yield* Schema.decodeUnknownEffect(
      Schema.Array(StoredUnsupported)
    )(rows).pipe(Effect.mapError(() => failure("unsupported", "storedRow")));

    return decoded[0] ?? null;
  });

  const markUnsupported = Effect.fn("googlePush.markUnsupported")(
    function* markUnsupported(input: typeof Unsupported.Type) {
      const value = yield* Schema.decodeEffect(Unsupported)(input).pipe(
        Effect.mapError(() => failure("markUnsupported", "input"))
      );

      const encoded = yield* Schema.encodeEffect(StoredUnsupported)(value).pipe(
        Effect.mapError(() => failure("markUnsupported", "input"))
      );

      yield* Effect.tryPromise({
        catch: () => failure("markUnsupported", "storage"),
        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          database
            .insert(GooglePushUnsupported)
            .values(encoded)
            .onConflictDoNothing()
            .run(),
      });
    }
  );

  const retainUnsupported = Effect.fn("googlePush.retainUnsupported")(
    function* retainUnsupported(
      personId: string,
      accountId: string,
      calendarIds: readonly string[]
    ) {
      const value = yield* Schema.decodeEffect(
        Schema.Struct({
          accountId: Schema.NonEmptyString,
          calendarIds: Schema.Array(Schema.NonEmptyString),
          personId: Schema.NonEmptyString,
        })
      )({ accountId, calendarIds, personId }).pipe(
        Effect.mapError(() => failure("retainUnsupported", "input"))
      );

      yield* Effect.tryPromise({
        catch: () => failure("retainUnsupported", "storage"),
        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          database
            .delete(GooglePushUnsupported)
            .where(
              and(
                eq(GooglePushUnsupported.personId, value.personId),
                eq(GooglePushUnsupported.accountId, value.accountId),
                sql`${GooglePushUnsupported.calendarId} NOT IN (SELECT value FROM json_each(${JSON.stringify(value.calendarIds)}))`
              )
            )
            .run(),
      });
    }
  );

  return { markUnsupported, retainUnsupported, unsupported };
};
