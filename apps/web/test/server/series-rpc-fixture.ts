import { createFakeAuth } from "@calendar/auth/dev/fake-google";
import {
  ConnectedGoogleAccount,
  googleTokensFor,
} from "@calendar/auth/google-tokens";
import { CalendarStore, GoogleHttp } from "@calendar/calendar";
import type {
  CalendarChangedValue,
  GoogleRequestValue,
  GoogleResponse,
  Provider,
} from "@calendar/calendar";
import { memoryCalendarStore } from "@calendar/calendar/memory";
import { Effect, Layer, Ref, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

import { seedFakePerson } from "../../src/dev/person.js";
import { createBackend } from "../../src/server/backend.js";
import { rpcDocument } from "./calendar-rpc.js";

export const zone = "America/Los_Angeles";

export const master = {
  end: { dateTime: "2026-03-01T10:00:00-08:00", timeZone: zone },
  iCalUID: "series@fixture.test",
  id: "master",
  organizer: { self: true },
  recurrence: ["RRULE:FREQ=WEEKLY;COUNT=5"],
  start: { dateTime: "2026-03-01T09:00:00-08:00", timeZone: zone },
  status: "confirmed",
  summary: "Series",
};

export const selected = {
  ...master,
  end: { dateTime: "2026-03-15T10:00:00-07:00", timeZone: zone },
  id: "selected",
  originalStartTime: { dateTime: "2026-03-15T09:00:00-07:00", timeZone: zone },
  recurringEventId: "master",
  start: { dateTime: "2026-03-15T09:00:00-07:00", timeZone: zone },
};

export const moved = { ...master, id: "destination-master" };

export const retimed = {
  ...moved,
  end: { dateTime: "2026-03-01T20:00:00.000Z", timeZone: zone },
  start: { dateTime: "2026-03-01T19:00:00.000Z", timeZone: zone },
};

export const reply = (status: number, body: Schema.Json = {}) =>
  Effect.succeed<GoogleResponse>({
    body: JSON.stringify(body),
    retryAfterMs: 0,
    status,
  });

interface PublishedChange {
  readonly personId: string;
  readonly change: CalendarChangedValue;
}

export const seriesRpcFixture = Effect.fn("test.seriesRpcFixture")(
  function* seriesRpcFixture(
    replies: readonly Effect.Effect<GoogleResponse, Provider>[]
  ) {
    const auth = createFakeAuth("http://calendar.test");
    const person = yield* seedFakePerson(auth, ["joel@example.test"]);
    const foreign = yield* seedFakePerson(auth, ["second@example.test"]);

    const tokens = yield* googleTokensFor(
      auth.auth,
      person.personId,
      auth.config
    );

    const foreignTokens = yield* googleTokensFor(
      auth.auth,
      foreign.personId,
      auth.config
    );

    const accounts = yield* tokens
      .accounts()
      .pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.NonEmptyArray(ConnectedGoogleAccount)
          )
        )
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

    const source = { accountId: accounts[0].id, calendarId: "source" };
    const destination = { ...source, calendarId: "destination" };

    const input = {
      ...source,
      destination,
      end: { dateTime: "2026-03-15T12:00:00-07:00", timeZone: zone },
      eventId: "selected",
      start: { dateTime: "2026-03-15T11:00:00-07:00", timeZone: zone },
    };

    const store = yield* CalendarStore.pipe(
      Effect.provide(memoryCalendarStore)
    );

    const requests = yield* Ref.make<readonly GoogleRequestValue[]>([]);

    const pending = yield* Ref.make(replies);

    const signals = yield* Ref.make<readonly PublishedChange[]>([]);

    const storePeople: string[] = [];

    const googleHttp = Layer.succeed(GoogleHttp, {
      execute: (request) =>
        Effect.gen(function* fakeGoogleRequest() {
          yield* Ref.update(requests, (previous) => [...previous, request]);

          const next = yield* Ref.modify(pending, (queue) => [
            queue[0],
            queue.slice(1),
          ]);

          if (next === undefined) {
            return yield* Effect.die(
              new Error("Unexpected fixture Google request")
            );
          }

          return yield* next;
        }),
    });

    const backend = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createBackend(
          auth.auth,
          auth.config,
          new Headers({ cookie: person.cookie }),
          {
            changesFor: (personId) => ({
              publish: (change) =>
                Ref.update(signals, (previous) => [
                  ...previous,
                  { change, personId },
                ]),
            }),
            googleHttp,
            storeFor: (personId) => {
              storePeople.push(personId);

              return Layer.succeed(CalendarStore, store);
            },
          }
        )
      ),
      (value) => Effect.promise(value.dispose.bind(value))
    );

    return {
      destination,
      foreignAccountId: foreignAccounts[0].id,
      input,
      personId: person.personId,
      requests,
      send: (payload: Schema.Json = input) =>
        rpcDocument(backend.handler, "moveAndRetimeSeries", payload),
      signals,
      source,
      store,
      storePeople,
    };
  },
  Effect.provide(FetchHttpClient.layer)
);
