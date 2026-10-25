import { Provider } from "@calendar/calendar";
import type { SqlStorageValue } from "@cloudflare/workers-types";
import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import { Crypto, Effect, Schema } from "effect";

import { GoogleMessageNumber } from "./google-push-protocol.js";
import {
  LiveOutput,
  StoredLiveJob,
  LiveWork,
  liveWorkKey,
} from "./live-work.js";
import type {
  LiveJobValue,
  LiveOutputValue,
  LiveWorkValue,
} from "./live-work.js";

const failure = () =>
  new Provider({
    message: "Live sync storage is unavailable",
    operation: "live.jobs",
    status: 0,
  });

const MessageNumber = GoogleMessageNumber;

const Selection =
  "SELECT job_key AS key, generation, payload AS work, due_at AS dueAt, attempts FROM live_job";

export interface LiveJobStorage {
  readonly sql: {
    readonly exec: (
      query: string,
      ...bindings: (string | number)[]
    ) => {
      readonly toArray: () => readonly Record<string, SqlStorageValue>[];
      readonly one: () => Record<string, SqlStorageValue>;
    };
  };
  readonly transactionSync: <T>(run: () => T) => T;
  readonly setAlarm: (time: number) => Promise<void>;
  readonly deleteAlarm: () => Promise<void>;
}

export const liveJobs = (
  storage: LiveJobStorage,
  accepts: () => boolean = () => true
) => {
  storage.sql.exec(
    "CREATE TABLE IF NOT EXISTS live_owner (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), person_id TEXT NOT NULL)"
  );
  storage.sql.exec(
    "CREATE TABLE IF NOT EXISTS live_job (job_key TEXT PRIMARY KEY, generation TEXT NOT NULL, payload TEXT NOT NULL, due_at INTEGER NOT NULL, attempts INTEGER NOT NULL)"
  );
  storage.sql.exec(
    "CREATE INDEX IF NOT EXISTS live_job_due ON live_job (due_at, job_key)"
  );
  storage.sql.exec(
    "CREATE TABLE IF NOT EXISTS live_result (job_key TEXT PRIMARY KEY, payload TEXT NOT NULL)"
  );
  storage.sql.exec(
    "CREATE TABLE IF NOT EXISTS live_message (channel_id TEXT PRIMARY KEY, message_number TEXT NOT NULL)"
  );

  const read = (key: string) => {
    const [row] = storage.sql
      .exec(`${Selection} WHERE job_key = ?`, key)
      .toArray();

    return row === undefined
      ? undefined
      : Schema.decodeUnknownSync(StoredLiveJob)(row);
  };

  const schedule = Effect.fn("liveJobs.schedule")(function* schedule(
    now: number
  ) {
    const rows = yield* Effect.try({
      catch: failure,
      try: () =>
        storage.sql
          .exec(`${Selection} ORDER BY due_at, job_key LIMIT 1`)
          .toArray(),
    });

    const decoded = yield* Schema.decodeUnknownEffect(
      Schema.Array(StoredLiveJob)
    )(rows).pipe(Effect.mapError(failure));

    const [job] = decoded;

    yield* Effect.tryPromise({
      catch: failure,

      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        job === undefined
          ? storage.deleteAlarm()
          : storage.setAlarm(Math.max(now + 1, job.dueAt)),
    });
  });

  const bindPerson = (personId: string) =>
    Effect.try({
      catch: failure,
      try: () => {
        storage.transactionSync(() => {
          if (!accepts()) {
            throw new Error("Live admission is paused");
          }

          const person = Schema.decodeSync(Schema.NonEmptyString)(personId);
          storage.sql.exec(
            "INSERT OR IGNORE INTO live_owner (singleton, person_id) VALUES (1, ?)",
            person
          );

          const row = storage.sql
            .exec(
              "SELECT person_id AS personId FROM live_owner WHERE singleton = 1"
            )
            .one();

          const owner = Schema.decodeUnknownSync(
            Schema.Struct({ personId: Schema.NonEmptyString })
          )(row);

          if (owner.personId !== person) {
            throw new Error("Live owner mismatch");
          }
        });
      },
    });

  const owner = Effect.try({
    catch: failure,
    try: () =>
      storage.sql
        .exec(
          "SELECT person_id AS personId FROM live_owner WHERE singleton = 1"
        )
        .one(),
  }).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.Struct({ personId: Schema.NonEmptyString })
      )
    ),
    Effect.mapError(failure)
  );

  const enqueue = Effect.fn("liveJobs.enqueue")(function* enqueue(
    work: LiveWorkValue,
    now: number,
    debounceMs: number,
    delivery?: { readonly id: string; readonly number: string }
  ) {
    const generation = yield* Crypto.Crypto.use(
      (crypto) => crypto.randomUUIDv4
    ).pipe(Effect.provide(BrowserCrypto.layer), Effect.mapError(failure));

    const accepted = yield* Effect.try({
      catch: failure,
      try: () =>
        storage.transactionSync(() => {
          if (!accepts()) {
            return false;
          }

          const payload = Schema.encodeSync(Schema.fromJsonString(LiveWork))(
            work
          );

          if (delivery !== undefined) {
            const number = Schema.decodeSync(MessageNumber)(delivery.number);

            const [row] = storage.sql
              .exec(
                "SELECT message_number AS number FROM live_message WHERE channel_id = ?",
                delivery.id
              )
              .toArray();

            if (row !== undefined) {
              const previous = Schema.decodeUnknownSync(
                Schema.Struct({ number: MessageNumber })
              )(row);

              if (BigInt(number) <= BigInt(previous.number)) {
                return false;
              }
            }

            storage.sql.exec(
              "INSERT INTO live_message (channel_id, message_number) VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET message_number = excluded.message_number",
              delivery.id,
              number
            );
          }

          const key = liveWorkKey(work);
          const previous = read(key);

          const coolingDown =
            LiveWork.guards.Inventory(work) &&
            previous !== undefined &&
            previous.attempts > 0;

          const dueAt = coolingDown
            ? previous.dueAt
            : Math.min(previous?.dueAt ?? Infinity, now + debounceMs);

          const attempts = coolingDown ? previous.attempts : 0;

          storage.sql.exec(
            "INSERT INTO live_job (job_key, generation, payload, due_at, attempts) VALUES (?, ?, ?, ?, ?) ON CONFLICT(job_key) DO UPDATE SET generation = excluded.generation, payload = excluded.payload, due_at = excluded.due_at, attempts = excluded.attempts",
            key,
            generation,
            payload,
            dueAt,
            attempts
          );

          return true;
        }),
    });

    yield* schedule(now);

    return accepted;
  });

  const get = (key: string) =>
    Effect.try({ catch: failure, try: () => read(key) });

  const last = (key: string) =>
    Effect.try({
      catch: failure,
      try: () =>
        storage.sql
          .exec("SELECT payload FROM live_result WHERE job_key = ?", key)
          .toArray(),
    }).pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({ payload: Schema.fromJsonString(LiveOutput) })
          )
        )
      ),
      Effect.map((rows) => rows[0]?.payload),
      Effect.mapError(failure)
    );

  const complete = (job: LiveJobValue, output: LiveOutputValue) =>
    Effect.try({
      catch: failure,
      try: () =>
        storage.transactionSync(() => {
          const current = read(job.key);

          const payload = Schema.encodeSync(Schema.fromJsonString(LiveOutput))(
            output
          );

          storage.sql.exec(
            "INSERT INTO live_result (job_key, payload) VALUES (?, ?) ON CONFLICT(job_key) DO UPDATE SET payload = excluded.payload",
            job.key,
            payload
          );

          if (current === undefined) {
            return true;
          }

          if (current.generation !== job.generation) {
            return false;
          }

          storage.sql.exec(
            "DELETE FROM live_job WHERE job_key = ? AND generation = ?",
            job.key,
            job.generation
          );

          return true;
        }),
    });

  const retry = Effect.fn("liveJobs.retry")(function* retry(
    job: LiveJobValue,
    now: number,
    delayMs: number
  ) {
    yield* Effect.try({
      catch: failure,
      try: () =>
        storage.sql.exec(
          "UPDATE live_job SET attempts = attempts + 1, due_at = ? WHERE job_key = ?",
          now + delayMs,
          job.key
        ),
    });

    yield* schedule(now);
  });

  const discard = (key: string) =>
    Effect.try({
      catch: failure,
      try: () => {
        storage.sql.exec("DELETE FROM live_job WHERE job_key = ?", key);
      },
    });

  const due = (now: number) =>
    Effect.try({
      catch: failure,
      try: () =>
        storage.sql
          .exec(
            `${Selection} WHERE due_at <= ? ORDER BY due_at, job_key LIMIT 100`,
            now
          )
          .toArray(),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(StoredLiveJob))),
      Effect.mapError(failure)
    );

  const clear = Effect.try({
    catch: failure,
    try: () => {
      storage.transactionSync(() => {
        for (const table of [
          "live_job",
          "live_result",
          "live_message",
          "live_owner",
        ]) {
          storage.sql.exec(`DELETE FROM ${table}`);
        }
      });
    },
  });

  return {
    bindPerson,
    clear,
    complete,
    discard,
    due,
    enqueue,
    get,
    last,
    owner,
    retry,
    schedule,
  };
};

export type LiveJobs = ReturnType<typeof liveJobs>;
