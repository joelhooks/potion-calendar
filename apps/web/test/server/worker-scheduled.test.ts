import { expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { vi } from "vitest";

import * as calendarCron from "../../src/server/calendar-cron.js";
import worker from "../../src/server/worker.js";
import { d1Fixture } from "./d1-fixture.js";

for (const failed of [0, 1]) {
  it.effect(
    `the Worker scheduled entrypoint reports ${failed === 0 ? "successful" : "partial failed"} calendar sync`,
    () =>
      Effect.gen(function* scheduledSync() {
        const database = yield* d1Fixture;

        const sync = yield* Effect.acquireRelease(
          Effect.sync(() =>
            vi
              .spyOn(calendarCron, "syncConnectedCalendars")
              .mockReturnValue(Effect.succeed({ failed, people: 1, synced: 0 }))
          ),
          (spy) =>
            Effect.sync(() => {
              spy.mockRestore();
            })
        );

        const result = yield* Effect.tryPromise(
          worker.scheduled.bind(
            worker,
            { cron: "*/15 * * * *", scheduledTime: 0 },
            {
              ALLOWED_EMAILS: "joel@example.test",
              ASSETS: {
                fetch: vi
                  .fn<(request: Request) => Promise<Response>>()
                  .mockResolvedValue(new Response("fixture")),
              },
              BETTER_AUTH_SECRET:
                "local-only-auth-secret-at-least-thirty-two-characters",
              DB: database,
              GOOGLE_CLIENT_ID: "local-client",
              GOOGLE_CLIENT_SECRET: "local-client-secret",
              RELEASE: "test-release",
            }
          )
        ).pipe(Effect.result);

        expect(sync).toHaveBeenCalledOnce();
        expect(sync.mock.calls[0]?.[1].allowedEmails).toBe("joel@example.test");
        expect(Result.isSuccess(result)).toBe(failed === 0);
      })
  );
}
