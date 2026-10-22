import { makeFakeGoogle } from "@calendar/auth/dev/fake-google";
import { createGoogleAuth } from "@calendar/auth/google";
import {
  ConnectedGoogleAccount,
  googleTokensFor,
} from "@calendar/auth/google-tokens";
import {
  CalendarReadFailure,
  CalendarStore,
  GoogleHttp,
} from "@calendar/calendar";
import type { GoogleRequestValue } from "@calendar/calendar";
import { CalendarEvent } from "@calendar/calendar/contracts";
import { memoryCalendarStore } from "@calendar/calendar/memory";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Ref, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

import {
  response,
  timedEvent,
} from "../../../../packages/calendar/test/fake-google.js";
import { seedFakePerson } from "../../src/dev/person.js";
import { createBackend } from "../../src/server/backend.js";
import { rpcDocument, rpcFailure, rpcValue } from "./calendar-rpc.js";

const fixture = Effect.fn("selectionCommandRpcFixture")(function* fixture() {
  const provider = makeFakeGoogle("http://calendar.test");

  const config = {
    allowedEmails: "owner@example.test,foreign@example.test",
    baseURL: "http://calendar.test",
    clientId: "calendar-local",
    clientSecret: "fixture-only-secret",
    secret: "selection-command-fixture-not-production",
    tokenEndpoint: "http://calendar.test/__fake-google/token",
  };

  const fake = {
    ...provider,
    auth: createGoogleAuth(config, undefined, provider.provider),
    config,
  };

  const person = yield* seedFakePerson(fake, ["owner@example.test"]);
  const foreign = yield* seedFakePerson(fake, ["foreign@example.test"]);

  const accountFor = Effect.fn("selectionCommandAccount")(function* accountFor(
    personId: string
  ) {
    const tokens = yield* googleTokensFor(fake.auth, personId, config);

    const accounts = yield* tokens
      .accounts()
      .pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.NonEmptyArray(ConnectedGoogleAccount)
          )
        )
      );

    return accounts[0].id;
  });

  const accountId = yield* accountFor(person.personId);
  const foreignAccountId = yield* accountFor(foreign.personId);
  const requests = yield* Ref.make<readonly GoogleRequestValue[]>([]);

  const anchor = timedEvent("anchor", "Recurring source", {
    originalStartTime: { dateTime: "2026-03-15T16:00:00Z" },
    recurringEventId: "series",
  });

  const neighbor = timedEvent("neighbor", "Next source", {
    end: { dateTime: "2026-03-16T17:00:00Z" },
    originalStartTime: { dateTime: "2026-03-16T16:00:00Z" },
    recurringEventId: "series",
    start: { dateTime: "2026-03-16T16:00:00Z" },
  });

  const googleHttp = Layer.succeed(GoogleHttp, {
    execute: (request: GoogleRequestValue) =>
      Effect.gen(function* providerRead() {
        yield* Ref.update(requests, (before) => [...before, request]);
        const url = new URL(request.path, "https://calendar.invalid");

        if (request.method !== "GET") {
          return yield* Effect.die(
            "Selected occurrence navigation attempted a provider write"
          );
        }

        return url.pathname.endsWith("/events/anchor")
          ? response(200, anchor)
          : response(200, { items: [neighbor] });
      }),
  });

  const store = yield* CalendarStore.pipe(Effect.provide(memoryCalendarStore));
  const people: string[] = [];

  const headers = new Headers({
    cookie: person.cookie,
    "x-person-id": foreign.personId,
  });

  const backend = yield* Effect.acquireRelease(
    Effect.sync(() =>
      createBackend(fake.auth, config, headers, {
        googleHttp,
        storeFor: (personId) => {
          people.push(personId);

          return Layer.succeed(CalendarStore, store);
        },
      })
    ),
    (value) => Effect.promise(value.dispose.bind(value))
  );

  return {
    accountId,
    foreignAccountId,
    people,
    personId: person.personId,
    requests,
    send: (selectedAccount: string) =>
      rpcDocument(backend.handler, "readNeighborOccurrence", {
        accountId: selectedAccount,
        calendarId: "calendar",
        direction: "next",
        eventId: "anchor",
      }),
  };
}, Effect.provide(FetchHttpClient.layer));

it.effect(
  "the real occurrence RPC uses the cookie person and only read-scoped GET requests",
  () =>
    Effect.gen(function* ownedOccurrenceRpc() {
      const rpc = yield* fixture();
      const body = yield* rpc.send(rpc.accountId);

      const decoded = yield* Schema.decodeUnknownEffect(
        rpcValue(Schema.NullOr(CalendarEvent))
      )(body);

      expect(decoded[0].exit.value?.eventId).toBe("neighbor");
      expect(rpc.people).toEqual([rpc.personId]);
      const requests = yield* Ref.get(rpc.requests);
      expect(requests).toHaveLength(2);
      expect(
        requests.every(
          (request) =>
            request.method === "GET" && request.accountId === rpc.accountId
        )
      ).toBe(true);
      expect(requests[1]?.path).toContain("iCalUID=series%40fake.test");
    })
);

it.effect(
  "the real occurrence RPC rejects another person's account before any provider request",
  () =>
    Effect.gen(function* foreignOccurrenceRpc() {
      const rpc = yield* fixture();
      const body = yield* rpc.send(rpc.foreignAccountId);

      const decoded = yield* Schema.decodeUnknownEffect(
        rpcFailure(CalendarReadFailure)
      )(body);

      expect(decoded[0].exit.cause[0].error.cause._tag).toBe("NotConnected");
      expect(yield* Ref.get(rpc.requests)).toHaveLength(0);
      expect(rpc.people).toHaveLength(0);
    })
);
