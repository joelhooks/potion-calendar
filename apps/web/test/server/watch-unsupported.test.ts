import {
  CalendarStore,
  CalendarSync,
  GoogleCalendarClient,
  GoogleHttp,
  GoogleRetryPolicy,
  GoogleTokens,
  Provider,
  syncCalendar,
} from "@calendar/calendar";
import type { GoogleRequestValue } from "@calendar/calendar";
import type { ListCalendarsOutput } from "@calendar/calendar/contracts";
import { googlePushRepository } from "@calendar/database/google-push";
import { BrowserCrypto } from "@effect/platform-browser";
import { expect, layer } from "@effect/vitest";
import {
  Cause,
  Clock,
  Context,
  Crypto,
  Effect,
  Layer,
  Redacted,
  Ref,
  Result,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";

import { d1CalendarStore } from "../../src/server/calendar-store.js";
import { maintainGoogleChannels } from "../../src/server/google-channel-maintenance.js";
import { pendingChannel, seededPushRepository } from "./google-push-fixture.js";
import { memoryMaintenanceState } from "./maintenance-state-fixture.js";

const accountId = "person-a-google";

const ref = { accountId, calendarId: "ordinary-resource" };

const resource = { ...ref, kind: "events" } as const;

const listing = {
  accounts: [
    {
      accountId,
      calendars: [
        {
          ...ref,
          accessRole: "reader",
          primary: false,
          timeZone: "UTC",
          title: "Ordinary calendar",
        },
        {
          ...ref,
          accessRole: "reader",
          calendarId: "working-resource",
          primary: false,
          timeZone: "UTC",
          title: "Working calendar",
        },
      ],
      colors: { calendar: {}, event: {} },
    },
  ],
} as const;

const historyResources = (calendarId: string) => {
  const current = { ...ref, calendarId };

  return {
    listing: {
      accounts: [
        {
          ...listing.accounts[0],
          calendars: listing.accounts[0].calendars.map((calendar) => ({
            ...calendar,
            calendarId:
              calendar.calendarId === ref.calendarId
                ? calendarId
                : `${calendarId}-working`,
          })),
        },
      ],
    },
    ref: current,
    resource: { ...current, kind: "events" } as const,
  };
};

class UnsupportedFixture extends Context.Service<
  UnsupportedFixture,
  Effect.Success<typeof seededPushRepository>
>()("test/UnsupportedFixture") {}

const unsupportedScenario = Effect.fn("test.unsupportedScenario")(
  function* unsupportedScenario(reason: string, status: 400 | 403) {
    const { database, repository } = yield* UnsupportedFixture;

    const {
      ref: historyRef,
      resource: historyResource,
      listing: historyListing,
    } = historyResources(
      yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4).pipe(
        Effect.provide(BrowserCrypto.layer),
        Effect.orDie
      )
    );

    const memory = yield* memoryMaintenanceState;
    const attempts = yield* Ref.make(0);
    const polls = yield* Ref.make(0);
    const reasons = [reason, "syntheticSecondReason"];

    const receipts = () =>
      Effect.tryPromise({
        catch: (cause) => new Cause.UnknownError(cause),
        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          database
            .prepare(
              "SELECT id, state, resource_id FROM google_push_channel WHERE calendar_id = ? ORDER BY id"
            )
            .bind(historyRef.calendarId)
            .all(),
      }).pipe(
        Effect.map((rows) => rows.results),
        Effect.orDie
      );

    const observedAt = yield* Clock.currentTimeMillis;

    const http = Layer.succeed(GoogleHttp, {
      execute: Effect.fn("test.unsupportedWatch")(function* execute(
        request: GoogleRequestValue
      ) {
        if (
          request.path === `/calendars/${historyRef.calendarId}/events/watch`
        ) {
          yield* Ref.update(attempts, (count) => count + 1);

          return {
            body: JSON.stringify({
              error: {
                errors: reasons.map((code) => ({ reason: code })),
                message: "private provider message",
              },
            }),
            retryAfterMs: 0,
            status,
          };
        }

        if (request.method === "GET") {
          const count = yield* Ref.updateAndGet(polls, (value) => value + 1);

          return {
            body: JSON.stringify({
              items: [
                {
                  end: { dateTime: "2026-10-21T12:00:00Z" },
                  id: "polled-event",
                  start: { dateTime: "2026-10-21T11:00:00Z" },
                  summary: `Polled change ${count}`,
                },
              ],
              nextSyncToken: `poll-${count}`,
            }),
            retryAfterMs: 0,
            status: 200,
          };
        }

        if (request.path === "/channels/stop") {
          return { body: "", retryAfterMs: 0, status: 204 };
        }

        const body = yield* Schema.decodeEffect(
          Schema.fromJsonString(Schema.Struct({ id: Schema.String }))
        )(request.body ?? "").pipe(Effect.orDie);

        return {
          body: JSON.stringify({
            expiration: (yield* Clock.currentTimeMillis) + 604_800_000,
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

    const run = (current: typeof ListCalendarsOutput.Type = historyListing) =>
      maintainGoogleChannels(
        googlePushRepository(database),
        "person-a",
        current,
        "https://calendar.example.test/google/push",
        memory.make()
      );

    return {
      attempts,
      database,
      historyListing,
      historyRef,
      historyResource,
      memory,
      observedAt,
      polls,
      reasons,
      receipts,
      repository,
      run,
      services,
    };
  }
);

layer(Layer.effect(UnsupportedFixture, seededPushRepository))(
  "durable unsupported watches",
  (it) => {
    it.effect.prop(
      "qualifying refusals persist all reason codes and suppress duplicate watch receipts",
      {
        reason: Schema.Literals([
          "invalidResource",
          "notFound",
          "syntheticRefusal",
        ]),
        status: Schema.Literals([400, 403]),
      },
      ({ reason, status }) =>
        Effect.gen(function* refusalHistory() {
          const scenario = yield* unsupportedScenario(reason, status);

          const single = {
            accounts: scenario.historyListing.accounts.map((account) => ({
              ...account,
              calendars: account.calendars.filter(
                (calendar) =>
                  calendar.calendarId === scenario.historyRef.calendarId
              ),
            })),
          };

          yield* Effect.gen(function* refusalProof() {
            yield* scenario.run(single);

            const marker = yield* scenario.repository.unsupported(
              "person-a",
              scenario.historyResource
            );

            expect(marker).toEqual({
              ...scenario.historyRef,
              observedAt: scenario.observedAt,
              personId: "person-a",
              reasonCodes: scenario.reasons,
              status,
            });
            const rejected = yield* scenario.receipts();
            expect(rejected).toHaveLength(1);
            yield* TestClock.adjust(24 * 60 * 60 * 1000 + 1);
            yield* scenario.run(single);
            expect(yield* Ref.get(scenario.attempts)).toBe(1);
            expect(yield* scenario.receipts()).toEqual(rejected);
            expect(
              yield* scenario.repository.unsupported(
                "person-a",
                scenario.historyResource
              )
            ).toEqual(marker);
            yield* scenario.repository.retainUnsupported(
              "person-a",
              accountId,
              []
            );
            expect(
              yield* scenario.repository.unsupported(
                "person-a",
                scenario.historyResource
              )
            ).toBeNull();
            expect(yield* scenario.receipts()).toEqual(rejected);
          }).pipe(
            Effect.provide(scenario.services),
            Effect.provideService(GoogleRetryPolicy, {
              baseDelayMs: 0,
              retries: 0,
            })
          );
        }),
      { arbitrary: { runs: 3 } }
    );

    it.effect(
      "one structured refusal prevents later pending rows across time and repository instances while polling refreshes and a confirmed removal rearms it",
      () =>
        Effect.gen(function* durableLifecycle() {
          const status = 400;

          const {
            attempts,
            database,
            historyListing,
            historyRef,
            historyResource,
            memory,
            observedAt,
            polls,
            receipts,
            reasons,
            repository,
            run,
            services,
          } = yield* unsupportedScenario("syntheticRefusal", status);

          const historical = {
            ...pendingChannel(
              yield* Crypto.Crypto.use((crypto) => crypto.randomUUIDv4).pipe(
                Effect.provide(BrowserCrypto.layer),
                Effect.orDie
              )
            ),
            ...historyResource,
          };

          yield* repository.insertPending(historical);
          yield* repository.finish("person-a", historical.id, "orphaned");
          const before = yield* receipts();

          yield* Effect.gen(function* history() {
            yield* run();
            expect(yield* Ref.get(attempts)).toBe(1);
            expect(
              (yield* repository.active("person-a", {
                ...historyResource,
                calendarId: `${historyRef.calendarId}-working`,
              }))?.state
            ).toBe("active");

            const mark = yield* repository.unsupported(
              "person-a",
              historyResource
            );

            expect(mark).toEqual({
              ...historyRef,
              observedAt,
              personId: "person-a",
              reasonCodes: reasons,
              status,
            });
            expect(JSON.stringify(mark)).not.toContain(
              "private provider message"
            );
            const rejected = yield* receipts();
            expect(rejected).toHaveLength(before.length + 1);
            expect(rejected).toEqual(expect.arrayContaining(before));

            yield* TestClock.adjust(366 * 24 * 60 * 60 * 1000);
            yield* run();
            yield* run();
            expect(yield* Ref.get(attempts)).toBe(1);
            expect(yield* receipts()).toEqual(rejected);
            expect(
              yield* repository.unsupported("person-a", historyResource)
            ).toEqual(mark);

            const store = yield* CalendarStore.pipe(
              Effect.provide(d1CalendarStore(database, "person-a"))
            );

            const sync = yield* CalendarSync.pipe(
              Effect.provide(CalendarSync.layer),
              Effect.provideService(CalendarStore, store)
            );

            const first = yield* syncCalendar(historyRef).pipe(
              Effect.provideService(CalendarSync, sync)
            );

            const second = yield* syncCalendar(historyRef).pipe(
              Effect.provideService(CalendarSync, sync)
            );

            expect(first.changed).toBe(1);
            expect(second.changed).toBe(1);
            expect(second.version).toBe(first.version + 1);
            expect((yield* store.read(historyRef)).cursor).toBe("poll-2");
            expect(yield* Ref.get(polls)).toBe(2);
            expect(yield* Ref.get(attempts)).toBe(1);

            yield* maintainGoogleChannels(
              googlePushRepository(database),
              "person-a",
              { accounts: [] },
              "https://calendar.example.test/google/push",
              memory.make()
            );
            expect(
              yield* repository.unsupported("person-a", historyResource)
            ).toEqual(mark);

            const failed = {
              accounts: [
                {
                  accountId,
                  failure: new Provider({
                    message: "offline",
                    operation: "GET",
                    status: 503,
                  }),
                },
              ],
            };

            yield* maintainGoogleChannels(
              googlePushRepository(database),
              "person-a",
              failed,
              "https://calendar.example.test/google/push",
              memory.make()
            ).pipe(Effect.result);
            expect(
              yield* repository.unsupported("person-a", historyResource)
            ).toEqual(mark);

            yield* run({
              accounts: historyListing.accounts.map((account) => ({
                ...account,
                calendars: [],
              })),
            });
            expect(
              yield* repository.unsupported("person-a", historyResource)
            ).toBeNull();
            expect(yield* receipts()).toEqual(rejected);
            yield* run();
            expect(yield* Ref.get(attempts)).toBe(2);
            expect(yield* receipts()).toHaveLength(rejected.length + 1);
            yield* repository.retainUnsupported("person-a", accountId, []);
          }).pipe(
            Effect.provide(services),
            Effect.provideService(GoogleRetryPolicy, {
              baseDelayMs: 0,
              retries: 0,
            })
          );
        })
    );

    it.effect(
      "a documented 404 retries after the existing cooldown instead of recording a permanent marker",
      () =>
        Effect.gen(function* notFoundBackoff() {
          const { repository } = yield* UnsupportedFixture;
          const memory = yield* memoryMaintenanceState;
          const attempts = yield* Ref.make(0);

          const http = Layer.succeed(GoogleHttp, {
            execute: Effect.fn("test.notFoundWatch")(function* execute(
              request: GoogleRequestValue
            ) {
              if (
                request.path === "/calendars/ordinary-resource/events/watch"
              ) {
                yield* Ref.update(attempts, (count) => count + 1);

                return {
                  body: JSON.stringify({
                    error: { errors: [{ reason: "notFound" }] },
                  }),
                  retryAfterMs: 0,
                  status: 404,
                };
              }

              const registration = yield* Schema.decodeEffect(
                Schema.fromJsonString(Schema.Struct({ id: Schema.String }))
              )(request.body ?? "").pipe(Effect.orDie);

              return {
                body: JSON.stringify({
                  expiration: (yield* Clock.currentTimeMillis) + 604_800_000,
                  id: registration.id,
                  resourceId: registration.id,
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

          yield* Effect.gen(function* retry() {
            yield* run();
            expect(yield* Ref.get(attempts)).toBe(1);
            expect(
              yield* repository.unsupported("person-a", resource)
            ).toBeNull();
            yield* TestClock.adjust(24 * 60 * 60 * 1000 - 1);
            yield* run();
            expect(yield* Ref.get(attempts)).toBe(1);
            yield* TestClock.adjust(1);
            yield* run();
            expect(yield* Ref.get(attempts)).toBe(2);
            expect(
              yield* repository.unsupported("person-a", resource)
            ).toBeNull();
          }).pipe(
            Effect.provide(services),
            Effect.provideService(GoogleRetryPolicy, {
              baseDelayMs: 0,
              retries: 0,
            })
          );
        })
    );

    it.effect(
      "D1 validates observations and stored rows and uses the person/account key for reads and reset",
      () =>
        Effect.gen(function* storageBoundaries() {
          const { database, repository } = yield* UnsupportedFixture;

          const invalid = yield* repository
            .markUnsupported({
              accountId,
              calendarId: "invalid-observation",
              observedAt: 0,
              personId: "person-a",
              reasonCodes: ["bad reason"],
              status: 400,
            })
            .pipe(Effect.result);

          expect(Result.isFailure(invalid)).toBe(true);

          if (Result.isFailure(invalid)) {
            expect(invalid.failure.reason).toBe("input");
          }

          expect(
            yield* repository.unsupported("person-a", {
              ...resource,
              calendarId: "invalid-observation",
            })
          ).toBeNull();

          yield* Effect.tryPromise({
            catch: (cause) => new Cause.UnknownError(cause),
            // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
            try: () =>
              database
                .prepare(
                  "INSERT INTO google_push_unsupported (person_id, account_id, calendar_id, status, reason_codes, observed_at) VALUES (?, ?, ?, 400, ?, 0)"
                )
                .bind(
                  "person-a",
                  accountId,
                  "invalid-stored",
                  JSON.stringify(["bad reason"])
                )
                .run(),
          }).pipe(Effect.orDie);

          const malformed = yield* repository
            .unsupported("person-a", {
              ...resource,
              calendarId: "invalid-stored",
            })
            .pipe(Effect.result);

          expect(Result.isFailure(malformed)).toBe(true);

          if (Result.isFailure(malformed)) {
            expect(malformed.failure.reason).toBe("storedRow");
          }

          yield* repository.retainUnsupported("person-a", accountId, []);

          for (const query of [
            "SELECT * FROM google_push_unsupported WHERE person_id = ? AND account_id = ? AND calendar_id = ? LIMIT 1",
            "DELETE FROM google_push_unsupported WHERE person_id = ? AND account_id = ? AND calendar_id NOT IN (SELECT value FROM json_each(?))",
          ]) {
            const plan = yield* Effect.tryPromise({
              catch: (cause) => new Cause.UnknownError(cause),
              // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
              try: () =>
                database
                  .prepare(`EXPLAIN QUERY PLAN ${query}`)
                  .bind(
                    "person-a",
                    accountId,
                    JSON.stringify(["ordinary-resource"])
                  )
                  .all(),
            }).pipe(Effect.orDie);

            const rows = yield* Schema.decodeUnknownEffect(
              Schema.Array(Schema.Struct({ detail: Schema.String }))
            )(plan.results).pipe(Effect.orDie);

            const search = rows.find((row) =>
              row.detail.includes("SEARCH google_push_unsupported")
            );

            expect(search?.detail).toContain("person_id=?");
            expect(search?.detail).toContain("account_id=?");
          }
        })
    );

    it.effect(
      "markers are idempotent, person/account/calendar scoped and survive unrelated removal",
      () =>
        Effect.gen(function* scope() {
          const { repository } = yield* UnsupportedFixture;

          const observation = {
            accountId,
            calendarId: "scope-resource",
            observedAt: 1,
            personId: "person-a",
            reasonCodes: ["notFound"],
            status: 400,
          } as const;

          yield* repository.markUnsupported(observation);
          yield* repository.markUnsupported({ ...observation, observedAt: 2 });
          const scoped = { ...resource, calendarId: observation.calendarId };
          expect(
            (yield* repository.unsupported("person-a", scoped))?.observedAt
          ).toBe(1);
          expect(yield* repository.unsupported("person-b", scoped)).toBeNull();
          expect(
            yield* repository.unsupported("person-a", {
              ...scoped,
              accountId: "other-account",
            })
          ).toBeNull();
          expect(
            yield* repository.unsupported("person-a", {
              ...scoped,
              calendarId: "other-calendar",
            })
          ).toBeNull();
          expect(
            yield* repository.unsupported("person-a", {
              accountId,
              calendarId: null,
              kind: "calendarList",
            })
          ).toBeNull();
          yield* repository.retainUnsupported("person-b", accountId, []);
          yield* repository.retainUnsupported("person-a", "other-account", []);
          expect(yield* repository.unsupported("person-a", scoped)).toEqual(
            observation
          );
          yield* repository.retainUnsupported("person-a", accountId, [
            observation.calendarId,
          ]);
          expect(yield* repository.unsupported("person-a", scoped)).toEqual(
            observation
          );
          yield* repository.retainUnsupported("person-a", accountId, []);
          expect(yield* repository.unsupported("person-a", scoped)).toBeNull();
        })
    );
  }
);
