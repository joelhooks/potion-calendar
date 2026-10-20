import { DatabaseSync } from "node:sqlite";

import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { vi } from "vitest";

import { liveJobs } from "../../src/server/live-jobs.js";
import type { LiveJobStorage } from "../../src/server/live-jobs.js";
import { LiveJob, LiveWork } from "../../src/server/live-work.js";

const storageFor = (database: DatabaseSync): LiveJobStorage => ({
  deleteAlarm: vi.fn<LiveJobStorage["deleteAlarm"]>().mockResolvedValue(),
  setAlarm: vi.fn<LiveJobStorage["setAlarm"]>().mockResolvedValue(),
  sql: {
    exec: (query, ...bindings) => {
      const rows = Schema.decodeUnknownSync(
        Schema.Array(
          Schema.Record(
            Schema.String,
            Schema.Union([Schema.String, Schema.Finite, Schema.Null])
          )
        )
      )(database.prepare(query).all(...bindings));

      return {
        one: () => {
          const [row] = rows;

          if (row === undefined || rows.length !== 1) {
            throw new Error("Expected one SQLite row");
          }

          return row;
        },
        toArray: () => rows,
      };
    },
  },
  transactionSync: (run) => {
    database.exec("BEGIN");

    try {
      const value = run();
      database.exec("COMMIT");

      return value;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  },
});

it.effect(
  "real live-job SQL preserves failed inventory attempts and deadline across fresh enqueues and storage reconstruction",
  () =>
    Effect.gen(function* durableBackoff() {
      const database = yield* Effect.acquireRelease(
        Effect.sync(() => new DatabaseSync(":memory:")),
        (connection) =>
          Effect.sync(() => {
            connection.close();
          })
      );

      const store = storageFor(database);
      const jobs = liveJobs(store);
      const work = LiveWork.cases.Inventory.make({});
      yield* jobs.bindPerson("person-a");
      yield* jobs.enqueue(work, 0, 0);

      const first = yield* jobs
        .get("inventory")
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(LiveJob)),
          Effect.orDie
        );

      yield* jobs.retry(first, 0, 300_000);
      yield* jobs.enqueue(work, 1000, 0);
      const reconstructed = liveJobs(store);
      const pending = yield* reconstructed.get("inventory");
      expect(pending?.attempts).toBe(1);
      expect(pending?.dueAt).toBe(300_000);
      expect(yield* reconstructed.due(299_999)).toEqual([]);
      expect(yield* reconstructed.due(300_000)).toHaveLength(1);
      yield* reconstructed.enqueue(work, 2000, 250, {
        id: "channel-a",
        number: "1",
      });
      expect((yield* reconstructed.get("inventory"))?.dueAt).toBe(300_000);
      expect((yield* reconstructed.get("inventory"))?.attempts).toBe(1);
    })
);
