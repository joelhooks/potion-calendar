import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { d1Fixture } from "./d1-fixture.js";

it.effect(
  "desktop redemption uses an indexed grant identifier rather than a verification table scan",
  () =>
    Effect.gen(function* indexedGrantConsumption() {
      const database = yield* d1Fixture;

      const statement = database
        .prepare(
          'EXPLAIN QUERY PLAN DELETE FROM verification WHERE identifier = ? AND "expiresAt" > ? RETURNING value'
        )
        .bind("calendar-desktop:probe", 0);

      const plan = yield* Effect.promise(statement.all.bind(statement));

      const rows = yield* Schema.decodeUnknownEffect(
        Schema.Array(Schema.Struct({ detail: Schema.String }))
      )(plan.results);

      expect(
        rows.some(
          (row) =>
            row.detail.includes("SEARCH verification USING INDEX") &&
            row.detail.includes("identifier=?")
        )
      ).toBe(true);
    }),
  30_000
);
