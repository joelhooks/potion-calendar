import { googlePushRepository } from "@calendar/database/google-push";
import type { PushChannelValue } from "@calendar/database/google-push";
import { Cause, Effect } from "effect";

import { d1Fixture } from "./d1-fixture.js";

export const pendingChannel = (
  id: string,
  personId = "person-a"
): PushChannelValue => ({
  accountId: `${personId}-google`,
  calendarId: "primary",
  createdAt: 0,
  expiresAt: 1000,
  id,
  kind: "events",
  personId,
  predecessorId: null,
  resourceId: null,
  state: "pending",
  tokenHash: "a".repeat(64),
});

export const seededPushRepository = Effect.gen(
  function* seededPushRepository() {
    const database = yield* d1Fixture;

    for (const person of ["person-a", "person-b"]) {
      const statements = [
        database
          .prepare(
            "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, 0, 0)"
          )
          .bind(person, person, `${person}@example.test`),
        database
          .prepare(
            "INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt, googleEmail, disconnected) VALUES (?, ?, 'google', ?, 0, 0, ?, 0)"
          )
          .bind(
            `${person}-google`,
            `${person}@example.test`,
            person,
            `${person}@example.test`
          ),
      ];

      yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Native Promise adapter failed"),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () => database.batch(statements),
      }).pipe(Effect.orDie);
    }

    return { database, repository: googlePushRepository(database) };
  }
);
