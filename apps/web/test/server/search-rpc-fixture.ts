import { makeFakeGoogle } from "@calendar/auth/dev/fake-google";
import { createGoogleAuth } from "@calendar/auth/google";
import {
  ConnectedGoogleAccount,
  googleTokensFor,
} from "@calendar/auth/google-tokens";
import { CalendarStore, GoogleHttp } from "@calendar/calendar";
import type { GoogleRequestValue, GoogleResponse } from "@calendar/calendar";
import { memoryCalendarStore } from "@calendar/calendar/memory";
import { Effect, Layer, Ref, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

import { seedFakePerson } from "../../src/dev/person.js";
import { createBackend } from "../../src/server/backend.js";
import { rpcDocument } from "./calendar-rpc.js";

export const searchPayload = {
  query: "needle",
  timeZone: "America/Los_Angeles",
  weekStartsOn: 1,
} as const;

const metadata = (accountId: string, accessRole = "owner") => ({
  accessRole,
  id: `calendar-${accountId}`,
  selected: false,
  summary: `Calendar ${accountId}`,
  timeZone: "America/Los_Angeles",
});

const response = (status: number, body: Schema.Json = {}): GoogleResponse => ({
  body: JSON.stringify(body),
  retryAfterMs: 0,
  status,
});

export const searchRpcFixture = Effect.fn("test.searchRpcFixture")(
  function* searchRpcFixture() {
    const provider = makeFakeGoogle("http://calendar.test");

    const config = {
      allowedEmails: "joel@example.test,work@example.test,second@example.test",
      baseURL: "http://calendar.test",
      clientId: "calendar-local",
      clientSecret: "fixture-only-secret",
      secret: "calendar-search-fixture-only-signing-key-not-production",
      tokenEndpoint: "http://calendar.test/__fake-google/token",
    };

    const fake = {
      ...provider,
      auth: createGoogleAuth(config, undefined, provider.provider),
      config,
    };

    const person = yield* seedFakePerson(fake, [
      "joel@example.test",
      "work@example.test",
    ]);

    const foreign = yield* seedFakePerson(fake, ["second@example.test"]);
    const tokens = yield* googleTokensFor(fake.auth, person.personId, config);

    const accounts = yield* tokens
      .accounts()
      .pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.Tuple([ConnectedGoogleAccount, ConnectedGoogleAccount])
          )
        )
      );

    const foreignTokens = yield* googleTokensFor(
      fake.auth,
      foreign.personId,
      config
    );

    const foreignAccounts = yield* foreignTokens
      .accounts()
      .pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.NonEmptyArray(ConnectedGoogleAccount)
          )
        )
      );

    const requests = yield* Ref.make<readonly GoogleRequestValue[]>([]);
    const failedInventories = yield* Ref.make<readonly string[]>([]);
    const emptyInventories = yield* Ref.make<readonly string[]>([]);
    const failedCalendars = yield* Ref.make<readonly string[]>([]);

    const store = yield* CalendarStore.pipe(
      Effect.provide(memoryCalendarStore)
    );

    const storePeople: string[] = [];

    const googleHttp = Layer.succeed(GoogleHttp, {
      execute: (request: GoogleRequestValue) =>
        Effect.gen(function* fakeRequest() {
          yield* Ref.update(requests, (previous) => [...previous, request]);
          const url = new URL(request.path, "https://fixture.test");

          if ((yield* Ref.get(failedInventories)).includes(request.accountId)) {
            return response(403);
          }

          if (url.pathname === "/colors") {
            return response(200, { calendar: {}, event: {} });
          }

          if (url.pathname === "/users/me/calendarList") {
            if (
              (yield* Ref.get(emptyInventories)).includes(request.accountId)
            ) {
              return response(200, { items: [] });
            }

            if (
              request.accountId === accounts[1].id &&
              !url.searchParams.has("pageToken")
            ) {
              return response(200, { items: [], nextPageToken: "hidden-page" });
            }

            return response(200, {
              items:
                request.accountId === accounts[0].id
                  ? [
                      metadata(request.accountId),
                      {
                        ...metadata(request.accountId, "freeBusyReader"),
                        id: "free-busy",
                      },
                    ]
                  : [metadata(request.accountId, "reader")],
            });
          }

          const calendarId = decodeURIComponent(
            url.pathname.split("/")[2] ?? ""
          );

          if (
            (yield* Ref.get(failedCalendars)).includes(calendarId) &&
            !url.searchParams.has("timeMin")
          ) {
            return response(403);
          }

          return response(200, {
            items: [
              {
                end: { dateTime: "2026-03-15T18:00:00Z" },
                id: `event-${calendarId}`,
                organizer: { displayName: "Owner" },
                start: { dateTime: "2026-03-15T17:00:00Z" },
                status: "confirmed",
                summary: `Result ${calendarId}`,
              },
            ],
          });
        }),
    });

    const options = {
      googleHttp,
      storeFor: (personId: string) => {
        storePeople.push(personId);

        return Layer.succeed(CalendarStore, store);
      },
    };

    const searchBackend = Effect.fn("test.searchBackend")(
      function* searchBackend(headers: Headers) {
        return yield* Effect.acquireRelease(
          Effect.sync(() => createBackend(fake.auth, config, headers, options)),
          (value) => Effect.promise(value.dispose.bind(value))
        );
      }
    );

    const backend = yield* searchBackend(
      new Headers({ cookie: person.cookie, "x-person-id": foreign.personId })
    );

    // oxlint-disable-next-line typescript/promise-function-async -- Better Auth exposes its initialization context as a native Promise getter.
    const context = yield* Effect.promise(() => fake.auth.$context);

    // oxlint-disable-next-line typescript/promise-function-async -- The native Fetch seam delegates directly to the in-memory RPC handler.
    const fetcher: typeof fetch = (input, init) =>
      backend.handler(new Request(input, init));

    return {
      accounts,
      clearAccounts: Effect.promise(
        context.adapter.deleteMany.bind(context.adapter, {
          model: "account",
          where: [{ field: "userId", value: person.personId }],
        })
      ).pipe(Effect.asVoid),
      disconnect: (accountId: string) =>
        Effect.promise(
          context.adapter.update.bind(context.adapter, {
            model: "account",
            update: { disconnected: true },
            where: [{ field: "id", value: accountId }],
          })
        ).pipe(Effect.asVoid),
      emptyInventories,
      failedCalendars,
      failedInventories,
      fetcher,
      foreignAccountId: foreignAccounts[0].id,
      foreignPersonId: foreign.personId,
      personId: person.personId,
      requests,
      send: (payload: Schema.Json = searchPayload) =>
        rpcDocument(backend.handler, "searchEvents", payload),
      sendAnonymous: Effect.gen(function* anonymousSearch() {
        const anonymous = yield* searchBackend(
          new Headers({ "x-person-id": foreign.personId })
        );

        return yield* rpcDocument(
          anonymous.handler,
          "searchEvents",
          searchPayload
        );
      }),
      storePeople,
    };
  },
  Effect.provide(FetchHttpClient.layer)
);
