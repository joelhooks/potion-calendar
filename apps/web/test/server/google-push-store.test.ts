import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  pendingChannel as pending,
  seededPushRepository as seededRepository,
} from "./google-push-fixture.js";

it.effect(
  "D1 overlaps renewal atomically and scopes channel reads to their person",
  () =>
    Effect.gen(function* renewalStorage() {
      const { repository } = yield* seededRepository;

      yield* repository.insertPending(pending("old"));
      yield* repository.insertPending(pending("foreign", "person-b"));

      expect((yield* repository.delivery("old", 0))?.state).toBe("pending");
      expect(
        yield* repository.activate({
          expiresAt: 1000,
          id: "old",
          personId: "person-a",
          predecessorId: null,
          resourceId: "old-resource",
        })
      ).toBe(true);

      yield* repository.insertPending({
        ...pending("new"),
        predecessorId: "old",
      });

      expect(
        (yield* repository.active("person-a", {
          accountId: "person-a-google",
          calendarId: "primary",
          kind: "events",
        }))?.id
      ).toBe("old");
      expect(
        yield* repository.activate({
          expiresAt: 2000,
          id: "new",
          personId: "person-a",
          predecessorId: "old",
          resourceId: "new-resource",
        })
      ).toBe(true);
      expect(yield* repository.delivery("old", 0)).toBeNull();
      expect((yield* repository.delivery("new", 0))?.resourceId).toBe(
        "new-resource"
      );
      expect(
        (yield* repository.list("person-b")).map((channel) => channel.id)
      ).toEqual(["foreign"]);
      expect(
        (yield* repository.list("person-a", { after: "new", limit: 1 })).map(
          (channel) => channel.id
        )
      ).toEqual(["old"]);

      yield* repository.finish("person-b", "new", "orphaned");

      expect((yield* repository.delivery("new", 0))?.id).toBe("new");

      yield* repository.finish("person-a", "new", "stopped");

      expect(yield* repository.delivery("new", 0)).toBeNull();
    })
);

it.effect(
  "the push lookup rejects expired, disconnected and unlinked accounts in its one query",
  () =>
    Effect.gen(function* invalidDelivery() {
      const { database, repository } = yield* seededRepository;

      yield* repository.insertPending(pending("channel"));

      expect(yield* repository.delivery("channel", 1000)).toBeNull();
      expect(yield* repository.delivery("unknown", 0)).toBeNull();

      const disconnect = database
        .prepare("UPDATE account SET disconnected = 1 WHERE id = ?")
        .bind("person-a-google");

      yield* Effect.promise(disconnect.run.bind(disconnect));

      expect(yield* repository.delivery("channel", 0)).toBeNull();

      const unlink = database
        .prepare("DELETE FROM account WHERE id = ?")
        .bind("person-a-google");

      yield* Effect.promise(unlink.run.bind(unlink));

      expect(yield* repository.delivery("channel", 0)).toBeNull();
    })
);

it.effect(
  "channel inputs and stored rows are decoded, and person pagination uses its index",
  () =>
    Effect.gen(function* validationAndPlan() {
      const { database, repository } = yield* seededRepository;

      const invalid = yield* repository
        .insertPending({ ...pending("invalid"), tokenHash: "not-a-hash" })
        .pipe(Effect.flip);

      expect(invalid.reason).toBe("input");
      expect(yield* repository.list("person-a")).toEqual([]);

      yield* repository.insertPending(pending("corrupt"));

      const corrupt = database
        .prepare("UPDATE google_push_channel SET token_hash = ? WHERE id = ?")
        .bind("invalid", "corrupt");

      yield* Effect.promise(corrupt.run.bind(corrupt));

      expect(
        (yield* repository.list("person-a").pipe(Effect.flip)).reason
      ).toBe("storedRow");

      const query = database
        .prepare(
          "EXPLAIN QUERY PLAN SELECT id FROM google_push_channel WHERE person_id = ? AND id > ? AND state IN ('pending', 'active', 'stopping') ORDER BY id LIMIT 100"
        )
        .bind("person-a", "");

      const document = yield* Effect.promise(query.all.bind(query));

      const rows = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          results: Schema.Array(Schema.Struct({ detail: Schema.String })),
        })
      )(document);

      expect(
        rows.results.some((row) =>
          row.detail.includes("google_push_person_page")
        )
      ).toBe(true);
    })
);
