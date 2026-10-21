import {
  GoogleCalendarClient,
  GoogleHttp,
  GoogleRetryPolicy,
  GoogleTokens,
  Provider,
} from "@calendar/calendar";
import type { GoogleRequestValue } from "@calendar/calendar";
import { BrowserCrypto } from "@effect/platform-browser";
import { expect, layer } from "@effect/vitest";
import {
  Clock,
  Context,
  Effect,
  Layer,
  Redacted,
  Ref,
  Result,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";

import { maintainGoogleChannels } from "../../src/server/google-channel-maintenance.js";
import { unwatchableWindowMs } from "../../src/server/live-maintenance-state.js";
import { seededPushRepository } from "./google-push-fixture.js";
import { memoryMaintenanceState } from "./maintenance-state-fixture.js";

const accountId = "person-a-google";

const calendar = (calendarId: string) =>
  ({
    accessRole: "reader",
    accountId,
    calendarId,
    primary: false,
    timeZone: "UTC",
    title: calendarId,
  }) as const;

const listing = {
  accounts: [
    {
      accountId,
      calendars: [calendar("ordinary-resource"), calendar("working-resource")],
      colors: { calendar: {}, event: {} },
    },
  ],
};

const resource = {
  accountId,
  calendarId: "ordinary-resource",
  kind: "events",
} as const;

const Registration = Schema.fromJsonString(
  Schema.Struct({ id: Schema.String })
);

class WatchFixture extends Context.Service<
  WatchFixture,
  Effect.Success<typeof seededPushRepository>
>()("test/WatchFixture") {}

layer(Layer.effect(WatchFixture, seededPushRepository))(
  "watch cooldown",
  (it) => {
    it.effect.prop(
      "other non-auth events-watch rejections retain the 24-hour cooldown across maintenance instances while other calendars remain watched",
      {
        reason: Schema.Literals(["invalidResource", "unrecognizedReason"]),
        status: Schema.Literals([404, 410, 422]),
      },
      ({ reason, status }) =>
        Effect.gen(function* rejectedWatch() {
          const { repository } = yield* WatchFixture;
          const memory = yield* memoryMaintenanceState;
          const attempts = yield* Ref.make<readonly string[]>([]);

          const http = Layer.succeed(GoogleHttp, {
            execute: Effect.fn("test.watchReject")(function* execute(
              request: GoogleRequestValue
            ) {
              yield* Ref.update(attempts, (calls) => [...calls, request.path]);

              if (
                request.path === "/calendars/ordinary-resource/events/watch"
              ) {
                return {
                  body: JSON.stringify({
                    error: {
                      errors: [{ domain: "global", reason }],
                      message: "private provider message",
                    },
                  }),
                  retryAfterMs: 0,
                  status,
                };
              }

              if (request.path === "/channels/stop") {
                return { body: "", retryAfterMs: 0, status: 204 };
              }

              const body = yield* Schema.decodeEffect(Registration)(
                request.body ?? ""
              ).pipe(Effect.orDie);

              return {
                body: JSON.stringify({
                  expiration:
                    (yield* Clock.currentTimeMillis) + 7 * 24 * 60 * 60 * 1000,
                  id: body.id,
                  resourceId: `resource-${body.id}`,
                }),
                retryAfterMs: 0,
                status: 200,
              };
            }),
          });

          const tokens = Layer.succeed(GoogleTokens, {
            accessToken: () => Effect.succeed(Redacted.make("test-token")),
            accounts: () =>
              Effect.succeed([
                {
                  disconnected: false,
                  email: "person-a@example.test",
                  id: accountId,
                },
              ]),
          });

          const services = Layer.mergeAll(
            http,
            tokens,
            GoogleCalendarClient.layer.pipe(
              Layer.provide(http),
              Layer.provide(tokens),
              Layer.provide(BrowserCrypto.layer)
            )
          );

          const run = () =>
            maintainGoogleChannels(
              repository,
              "person-a",
              listing,
              "https://calendar.example.test/google/push",
              memory.make()
            );

          yield* Effect.gen(function* history() {
            yield* run();
            expect(
              (yield* repository.active("person-a", {
                ...resource,
                calendarId: "working-resource",
              }))?.state
            ).toBe("active");
            expect(
              yield* repository.active("person-a", resource)
            ).toBeUndefined();
            const first = yield* Ref.get(attempts);
            expect(
              first.filter(
                (path) => path === "/calendars/ordinary-resource/events/watch"
              )
            ).toHaveLength(1);

            yield* TestClock.adjust(unwatchableWindowMs - 1);
            yield* run();
            expect(
              (yield* Ref.get(attempts)).filter(
                (path) => path === "/calendars/ordinary-resource/events/watch"
              )
            ).toHaveLength(1);

            const stored = JSON.stringify([
              ...(yield* Ref.get(memory.values)).values(),
            ]);

            expect(stored).toContain(reason);
            expect(stored).not.toContain("private provider message");
            expect(
              yield* memory
                .make()
                .blocked(
                  { ...resource, accountId: "person-b-google" },
                  yield* Clock.currentTimeMillis
                )
            ).toBe(false);
            yield* TestClock.adjust(1);
            yield* run();
            expect(
              (yield* Ref.get(attempts)).filter(
                (path) => path === "/calendars/ordinary-resource/events/watch"
              )
            ).toHaveLength(2);
          }).pipe(
            Effect.provide(services),
            Effect.provideService(GoogleRetryPolicy, {
              baseDelayMs: 0,
              retries: 0,
            })
          );
        }),
      { arbitrary: { runs: 3 } }
    );

    it.effect.prop(
      "auth, rate, server and transport failures remain failures and never become unwatchable",
      {
        status: Schema.Literals([0, 401, 403, 429, 500, 503]),
      },
      ({ status }) =>
        Effect.gen(function* realWatchFailure() {
          const { repository } = yield* WatchFixture;
          const memory = yield* memoryMaintenanceState;

          const http = Layer.succeed(GoogleHttp, {
            execute: () =>
              status === 0
                ? Effect.fail(
                    new Provider({
                      message: "offline",
                      operation: "POST",
                      status: 0,
                    })
                  )
                : Effect.succeed({
                    body: JSON.stringify({
                      error: {
                        errors: [{ reason: "quotaExceeded" }],
                      },
                    }),
                    retryAfterMs: 0,
                    status,
                  }),
          });

          const tokens = Layer.succeed(GoogleTokens, {
            accessToken: () => Effect.succeed(Redacted.make("test-token")),
            accounts: () =>
              Effect.succeed([
                {
                  disconnected: false,
                  email: "person-a@example.test",
                  id: accountId,
                },
              ]),
          });

          const outcome = yield* maintainGoogleChannels(
            repository,
            "person-a",
            listing,
            "https://calendar.example.test/google/push",
            memory.make()
          ).pipe(
            Effect.provide(
              Layer.mergeAll(
                http,
                tokens,
                GoogleCalendarClient.layer.pipe(
                  Layer.provide(http),
                  Layer.provide(tokens),
                  Layer.provide(BrowserCrypto.layer)
                )
              )
            ),
            Effect.provideService(GoogleRetryPolicy, {
              baseDelayMs: 0,
              retries: 0,
            }),
            Effect.result
          );

          expect(Result.isFailure(outcome)).toBe(true);
          expect((yield* Ref.get(memory.values)).size).toBe(0);
        }),
      { arbitrary: { runs: 8 } }
    );
  }
);
