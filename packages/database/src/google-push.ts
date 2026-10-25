import type { D1Database } from "@cloudflare/workers-types";
import { and, eq, exists, gt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";

import { GooglePushStoreError } from "./google-push-error.js";
import { pushUnsupportedRepository } from "./push-unsupported.js";
import { GooglePushChannels } from "./schema/google-push.js";

export { GooglePushStoreError } from "./google-push-error.js";

export const PushResource = Schema.Union([
  Schema.Struct({
    accountId: Schema.NonEmptyString,
    calendarId: Schema.NonEmptyString,
    kind: Schema.Literal("events"),
  }),
  Schema.Struct({
    accountId: Schema.NonEmptyString,
    calendarId: Schema.Null,
    kind: Schema.Literal("calendarList"),
  }),
]);

export type PushResourceValue = typeof PushResource.Type;

const ChannelFields = {
  createdAt: Schema.Int,
  expiresAt: Schema.Int,
  id: Schema.NonEmptyString,
  personId: Schema.NonEmptyString,
  predecessorId: Schema.NullOr(Schema.NonEmptyString),
  resourceId: Schema.NullOr(Schema.NonEmptyString),
  state: Schema.Literals([
    "pending",
    "active",
    "stopping",
    "stopped",
    "orphaned",
  ]),
  tokenHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
};

export const PushChannel = Schema.Union([
  Schema.Struct({ ...PushResource.members[0].fields, ...ChannelFields }),
  Schema.Struct({ ...PushResource.members[1].fields, ...ChannelFields }),
]);

export type PushChannelValue = typeof PushChannel.Type;

const DeliveryFields = {
  accountEmail: Schema.String,
  ownerEmail: Schema.String,
};

export const PushDelivery = Schema.Union([
  Schema.Struct({ ...PushChannel.members[0].fields, ...DeliveryFields }),
  Schema.Struct({ ...PushChannel.members[1].fields, ...DeliveryFields }),
]);

export type PushDeliveryValue = typeof PushDelivery.Type;

const Activation = Schema.Struct({
  expiresAt: Schema.Int,
  id: Schema.NonEmptyString,
  personId: Schema.NonEmptyString,
  predecessorId: Schema.NullOr(Schema.NonEmptyString),
  resourceId: Schema.NonEmptyString,
});

const Page = Schema.Struct({
  after: Schema.optionalKey(Schema.String),
  limit: Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 1 })),
});

const Person = Schema.NonEmptyString;

const failure = (
  operation: string,
  reason: "input" | "storage" | "storedRow"
) => new GooglePushStoreError({ operation, reason });

export const googlePushRepository = (binding: D1Database) => {
  const database = drizzle(binding);

  const insertPending = Effect.fn("googlePush.insertPending")(
    function* insertPending(input: PushChannelValue) {
      const channel = yield* Schema.decodeEffect(PushChannel)(input).pipe(
        Effect.mapError(() => failure("insertPending", "input"))
      );

      if (channel.state !== "pending" || channel.resourceId !== null) {
        return yield* failure("insertPending", "input");
      }

      const inserted = yield* Effect.tryPromise({
        catch: () => failure("insertPending", "storage"),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          binding
            .prepare(`INSERT INTO google_push_channel
              (id, person_id, account_id, calendar_id, kind, token_hash, resource_id, expires_at, created_at, predecessor_id, state)
              SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
              WHERE EXISTS (SELECT 1 FROM user WHERE id = ?)`)
            .bind(
              channel.id,
              channel.personId,
              channel.accountId,
              channel.calendarId,
              channel.kind,
              channel.tokenHash,
              channel.resourceId,
              channel.expiresAt,
              channel.createdAt,
              channel.predecessorId,
              channel.state,
              channel.personId
            )
            .run(),
      });

      if (inserted.meta.changes !== 1) {
        return yield* failure("insertPending", "storage");
      }

      return yield* Effect.void;
    }
  );

  const activate = Effect.fn("googlePush.activate")(function* activate(
    input: typeof Activation.Type
  ) {
    const value = yield* Schema.decodeEffect(Activation)(input).pipe(
      Effect.mapError(() => failure("activate", "input"))
    );

    const pending = database
      .select({ id: GooglePushChannels.id })
      .from(GooglePushChannels)
      .where(
        and(
          eq(GooglePushChannels.id, value.id),
          eq(GooglePushChannels.personId, value.personId),
          eq(GooglePushChannels.state, "pending")
        )
      );

    const retire = database
      .update(GooglePushChannels)
      .set({ state: "stopping" })
      .where(
        and(
          eq(GooglePushChannels.id, value.predecessorId ?? ""),
          eq(GooglePushChannels.personId, value.personId),
          exists(pending)
        )
      );

    const accept = database
      .update(GooglePushChannels)
      .set({
        expiresAt: value.expiresAt,
        resourceId: value.resourceId,
        state: "active",
      })
      .where(
        and(
          eq(GooglePushChannels.id, value.id),
          eq(GooglePushChannels.personId, value.personId),
          eq(GooglePushChannels.state, "pending")
        )
      )
      .returning({ id: GooglePushChannels.id });

    const raw: unknown = yield* Effect.tryPromise({
      catch: () => failure("activate", "storage"),

      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () => database.batch([retire, accept]),
    });

    const rows = Schema.Array(Schema.Struct({ id: Schema.String }));

    const [, accepted] = yield* Schema.decodeUnknownEffect(
      Schema.Tuple([Schema.Struct({ success: Schema.Literal(true) }), rows])
    )(raw).pipe(Effect.mapError(() => failure("activate", "storedRow")));

    return accepted.length === 1;
  });

  const list = Effect.fn("googlePush.list")(function* list(
    personId: string,
    input?: typeof Page.Type
  ) {
    const person = yield* Schema.decodeEffect(Person)(personId).pipe(
      Effect.mapError(() => failure("list", "input"))
    );

    const page = yield* Schema.decodeEffect(Page)(input ?? { limit: 100 }).pipe(
      Effect.mapError(() => failure("list", "input"))
    );

    const rows = yield* Effect.tryPromise({
      catch: () => failure("list", "storage"),

      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        database
          .select()
          .from(GooglePushChannels)
          .where(
            and(
              eq(GooglePushChannels.personId, person),
              gt(GooglePushChannels.id, page.after ?? ""),
              sql`${GooglePushChannels.state} IN ('pending', 'active', 'stopping')`
            )
          )
          .orderBy(GooglePushChannels.id)
          .limit(page.limit)
          .all(),
    });

    return yield* Schema.decodeUnknownEffect(Schema.Array(PushChannel))(
      rows
    ).pipe(Effect.mapError(() => failure("list", "storedRow")));
  });

  const active = Effect.fn("googlePush.active")(function* active(
    personId: string,
    input: PushResourceValue
  ) {
    const person = yield* Schema.decodeEffect(Person)(personId).pipe(
      Effect.mapError(() => failure("active", "input"))
    );

    const resource = yield* Schema.decodeEffect(PushResource)(input).pipe(
      Effect.mapError(() => failure("active", "input"))
    );

    const rows = yield* Effect.tryPromise({
      catch: () => failure("active", "storage"),

      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        database
          .select()
          .from(GooglePushChannels)
          .where(
            and(
              eq(GooglePushChannels.personId, person),
              eq(GooglePushChannels.accountId, resource.accountId),
              eq(GooglePushChannels.kind, resource.kind),
              eq(
                sql`coalesce(${GooglePushChannels.calendarId}, '')`,
                resource.calendarId ?? ""
              ),
              eq(GooglePushChannels.state, "active")
            )
          )
          .limit(1)
          .all(),
    });

    const decoded = yield* Schema.decodeUnknownEffect(
      Schema.Array(PushChannel)
    )(rows).pipe(Effect.mapError(() => failure("active", "storedRow")));

    return decoded[0];
  });

  const retireObserved = Effect.fn("googlePush.retireObserved")(
    function* retireObserved(personId: string, id: string, resourceId: string) {
      const value = yield* Schema.decodeEffect(
        Schema.Struct({ id: Person, personId: Person, resourceId: Person })
      )({ id, personId, resourceId }).pipe(
        Effect.mapError(() => failure("retireObserved", "input"))
      );

      yield* Effect.tryPromise({
        catch: () => failure("retireObserved", "storage"),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          database
            .update(GooglePushChannels)
            .set({ resourceId: value.resourceId, state: "stopping" })
            .where(
              and(
                eq(GooglePushChannels.id, value.id),
                eq(GooglePushChannels.personId, value.personId),
                eq(GooglePushChannels.state, "pending")
              )
            )
            .run(),
      });
    }
  );

  const beginStop = Effect.fn("googlePush.beginStop")(function* beginStop(
    personId: string,
    id: string
  ) {
    const value = yield* Schema.decodeEffect(
      Schema.Struct({ id: Person, personId: Person })
    )({ id, personId }).pipe(
      Effect.mapError(() => failure("beginStop", "input"))
    );

    yield* Effect.tryPromise({
      catch: () => failure("beginStop", "storage"),

      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        database
          .update(GooglePushChannels)
          .set({ state: "stopping" })
          .where(
            and(
              eq(GooglePushChannels.id, value.id),
              eq(GooglePushChannels.personId, value.personId),
              sql`${GooglePushChannels.state} IN ('pending', 'active')`
            )
          )
          .run(),
    });
  });

  const finish = Effect.fn("googlePush.finish")(function* finish(
    personId: string,
    id: string,
    state: "stopped" | "orphaned"
  ) {
    const person = yield* Schema.decodeEffect(Person)(personId).pipe(
      Effect.mapError(() => failure("finish", "input"))
    );

    const channel = yield* Schema.decodeEffect(Person)(id).pipe(
      Effect.mapError(() => failure("finish", "input"))
    );

    yield* Effect.tryPromise({
      catch: () => failure("finish", "storage"),

      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        database
          .update(GooglePushChannels)
          .set({ state })
          .where(
            and(
              eq(GooglePushChannels.personId, person),
              eq(GooglePushChannels.id, channel)
            )
          )
          .run(),
    });
  });

  const delivery = Effect.fn("googlePush.delivery")(function* delivery(
    id: string,
    now: number
  ) {
    const statement = binding
      .prepare(
        `SELECT c.id, c.person_id AS personId, c.account_id AS accountId, c.calendar_id AS calendarId, c.kind, c.token_hash AS tokenHash, c.resource_id AS resourceId, c.expires_at AS expiresAt, c.created_at AS createdAt, c.predecessor_id AS predecessorId, c.state, a.googleEmail AS accountEmail, u.email AS ownerEmail FROM google_push_channel c JOIN account a ON a.id = c.account_id AND a.userId = c.person_id AND a.providerId = 'google' AND a.disconnected = 0 JOIN user u ON u.id = c.person_id WHERE c.id = ? AND c.expires_at > ? AND c.state IN ('pending', 'active') LIMIT 1`
      )
      .bind(id, now);

    const row = yield* Effect.tryPromise({
      catch: () => failure("delivery", "storage"),

      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () => statement.first(),
    });

    return yield* Schema.decodeUnknownEffect(Schema.NullOr(PushDelivery))(
      row
    ).pipe(Effect.mapError(() => failure("delivery", "storedRow")));
  });

  return {
    ...pushUnsupportedRepository(binding),
    activate,
    active,
    beginStop,
    delivery,
    finish,
    insertPending,
    list,
    retireObserved,
  };
};

export type GooglePushRepository = ReturnType<typeof googlePushRepository>;
