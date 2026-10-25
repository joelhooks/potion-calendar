import { deleteCalendarAccount } from "@calendar/database";
import { expect, it } from "@effect/vitest";
import { Cause, Effect, Result } from "effect";

import { d1Fixture, seedCalendarCacheOwners } from "./d1-fixture.js";

it.effect(
  "actual D1 verification triggers refuse delayed owned state after deletion and preserve B, unowned and malformed state",
  () =>
    Effect.gen(function* verificationOwnerFence() {
      const database = yield* d1Fixture;

      yield* seedCalendarCacheOwners(database, ["a", "b"]);

      const insert = (identifier: string, value: string) =>
        database
          .prepare(
            'INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES (?, ?, ?, 9999999999999, 1, 1)'
          )
          .bind(identifier, identifier, value);

      const delayedLink = insert(
        "delayed-link",
        JSON.stringify({ link: { userId: "a" }, oauthState: "delayed-link" })
      );

      const delayedDesktop = insert(
        "calendar-desktop:delayed",
        JSON.stringify({ personId: "a", sessionToken: "captured" })
      );

      yield* deleteCalendarAccount(database, "a");

      for (const statement of [delayedLink, delayedDesktop]) {
        const result = yield* Effect.tryPromise({
          catch: (cause) =>
            new Cause.UnknownError(cause, "Verification insert refused"),
          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () => statement.run(),
        }).pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
      }

      const values = [
        [
          "b-link",
          JSON.stringify({ link: { userId: "b" }, oauthState: "b-link" }),
        ],
        [
          "calendar-desktop:b",
          JSON.stringify({ personId: "b", sessionToken: "live" }),
        ],
        ["signin", JSON.stringify({ oauthState: "signin" })],
        ["malformed", "not-json"],
        ["calendar-desktop:unowned", "{}"],
        ["calendar-desktop:malformed", "not-json"],
      ] as const;

      for (const [identifier, value] of values) {
        const statement = insert(identifier, value);

        yield* Effect.promise(statement.run.bind(statement));
      }

      const statement = database.prepare(
        "SELECT identifier, value FROM verification ORDER BY identifier"
      );

      const rows = yield* Effect.promise(statement.all.bind(statement));

      expect(rows.results).toEqual(
        values
          .map(([identifier, value]) => ({ identifier, value }))
          .toSorted((first, second) =>
            first.identifier.localeCompare(second.identifier)
          )
      );
    })
);
