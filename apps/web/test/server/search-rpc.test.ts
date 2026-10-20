import { NotConnected, Provider, Revoked } from "@calendar/calendar";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Ref, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { browserGroup } from "../../src/client/rpc.js";
import {
  SearchInventoryUnavailable,
  SearchResponse,
} from "../../src/search-contract.js";
import { rpcFailure, rpcValue } from "./calendar-rpc.js";
import { searchPayload, searchRpcFixture } from "./search-rpc-fixture.js";

const protocol = RpcClient.layerProtocolHttp({
  url: "http://calendar.test/rpc",
}).pipe(
  Layer.provide(RpcSerialization.layerJson),
  Layer.provide(FetchHttpClient.layer)
);

type Fixture = Effect.Success<ReturnType<typeof searchRpcFixture>>;

const readSearch = (fixture: Fixture) =>
  fixture.send().pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(rpcValue(SearchResponse))),
    Effect.map((document) => document[0].exit.value)
  );

it.effect(
  "browser search RPC builds full inventory across two accounts and ignores spoofed person headers",
  () =>
    Effect.gen(function* fullInventory() {
      const fixture = yield* searchRpcFixture();

      const result = yield* RpcClient.make(browserGroup).pipe(
        Effect.flatMap((client) => client.searchEvents(searchPayload)),
        Effect.provide(protocol),
        Effect.provideService(FetchHttpClient.Fetch, fixture.fetcher),
        Effect.scoped
      );

      expect(result.results.map((row) => row.event.accountId)).toEqual(
        fixture.accounts.map((account) => account.id)
      );
      expect(result.results.map((row) => row.calendar.accessRole)).toEqual([
        "owner",
        "reader",
      ]);
      expect(result.accountFailures).toEqual([]);
      expect(result.failures).toEqual([]);
      const requests = yield* Ref.get(fixture.requests);
      expect(
        requests.every((request) =>
          fixture.accounts.some((account) => account.id === request.accountId)
        )
      ).toBe(true);
      expect(
        requests.some(
          (request) => request.accountId === fixture.foreignAccountId
        )
      ).toBe(false);
      expect(
        requests.filter(
          (request) =>
            new URL(request.path, "https://fixture.test").pathname ===
            "/users/me/calendarList"
        )
      ).toHaveLength(3);

      const events = requests.filter((request) =>
        new URL(request.path, "https://fixture.test").pathname.includes(
          "/events"
        )
      );

      expect(events).toHaveLength(4);
      expect(events.some((request) => request.path.includes("free-busy"))).toBe(
        false
      );
      expect(fixture.storePeople).toEqual([fixture.personId]);
    })
);

it.effect(
  "search RPC preserves typed per-calendar failures while other accounts still return results",
  () =>
    Effect.gen(function* partialCalendar() {
      const fixture = yield* searchRpcFixture();
      yield* Ref.set(fixture.failedCalendars, [
        `calendar-${fixture.accounts[1].id}`,
      ]);
      const result = yield* readSearch(fixture);
      expect(result.results.map((row) => row.event.accountId)).toEqual([
        fixture.accounts[0].id,
      ]);
      expect(result.accountFailures).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.accountId).toBe(fixture.accounts[1].id);
      expect(result.failures[0]?.cause).toBeInstanceOf(Provider);
    })
);

for (const mode of ["revoked", "provider"]) {
  it.effect(
    `search RPC keeps an account's ${mode} inventory failure beside successful results`,
    () =>
      Effect.gen(function* partialInventory() {
        const fixture = yield* searchRpcFixture();

        yield* mode === "revoked"
          ? fixture.disconnect(fixture.accounts[1].id)
          : Ref.set(fixture.failedInventories, [fixture.accounts[1].id]);

        const result = yield* readSearch(fixture);
        expect(result.results.map((row) => row.event.accountId)).toEqual([
          fixture.accounts[0].id,
        ]);
        expect(result.failures).toEqual([]);
        expect(result.accountFailures).toHaveLength(1);
        expect(result.accountFailures[0]?.accountId).toBe(
          fixture.accounts[1].id
        );
        expect(result.accountFailures[0]?.failure).toBeInstanceOf(
          mode === "revoked" ? Revoked : Provider
        );
        expect(
          (yield* Ref.get(fixture.requests)).filter(
            (request) =>
              request.accountId === fixture.accounts[1].id &&
              request.path.includes("/events")
          )
        ).toEqual([]);
      })
  );
}

it.effect("an empty but loaded inventory is still a successful account", () =>
  Effect.gen(function* emptyInventory() {
    const fixture = yield* searchRpcFixture();
    yield* Ref.set(fixture.emptyInventories, [fixture.accounts[0].id]);
    yield* fixture.disconnect(fixture.accounts[1].id);
    const result = yield* readSearch(fixture);
    expect(result.results).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.accountFailures.map((account) => account.accountId)).toEqual([
      fixture.accounts[1].id,
    ]);
    expect(
      (yield* Ref.get(fixture.requests)).every(
        (request) => !request.path.includes("/events")
      )
    ).toBe(true);
  })
);

it.effect(
  "search RPC fails with all account failures when no inventory loads",
  () =>
    Effect.gen(function* noInventory() {
      const fixture = yield* searchRpcFixture();

      for (const account of fixture.accounts) {
        yield* fixture.disconnect(account.id);
      }

      const document = yield* fixture.send();

      const failure = (yield* Schema.decodeUnknownEffect(
        rpcFailure(SearchInventoryUnavailable)
      )(document))[0].exit.cause[0].error;

      expect(failure.reason).toBe("allInventoriesFailed");
      expect(
        failure.accountFailures.map((account) => account.accountId)
      ).toEqual(fixture.accounts.map((account) => account.id));
      expect(
        failure.accountFailures.every((account) =>
          Schema.is(Revoked)(account.failure)
        )
      ).toBe(true);
      expect(yield* Ref.get(fixture.requests)).toEqual([]);
    })
);

it.effect(
  "a person with no accounts cannot search another person's inventory",
  () =>
    Effect.gen(function* noAccounts() {
      const fixture = yield* searchRpcFixture();
      yield* fixture.clearAccounts;
      const document = yield* fixture.send();

      const failure = (yield* Schema.decodeUnknownEffect(
        rpcFailure(SearchInventoryUnavailable)
      )(document))[0].exit.cause[0].error;

      expect(failure.reason).toBe("noAccounts");
      expect(failure.accountFailures).toEqual([]);
      expect(yield* Ref.get(fixture.requests)).toEqual([]);
    })
);

it.effect(
  "whitespace search RPC skips inventory and event calls even with no linked accounts",
  () =>
    Effect.gen(function* whitespace() {
      const fixture = yield* searchRpcFixture();
      yield* fixture.clearAccounts;

      const document = yield* fixture.send({
        ...searchPayload,
        query: " \t\n ",
      });

      const result = (yield* Schema.decodeUnknownEffect(
        rpcValue(SearchResponse)
      )(document))[0].exit.value;

      expect(result.results).toEqual([]);
      expect(result.failures).toEqual([]);
      expect(result.accountFailures).toEqual([]);
      expect(result.pageInfo).toEqual([]);
      expect(yield* Ref.get(fixture.requests)).toEqual([]);
    })
);

it.effect(
  "core search payloads with client calendars are rejected before storage or Google",
  () =>
    Effect.gen(function* rejectClientCalendars() {
      const fixture = yield* searchRpcFixture();

      for (const accountId of [
        fixture.accounts[0].id,
        fixture.foreignAccountId,
      ]) {
        const document = yield* fixture.send({
          ...searchPayload,
          calendars: [
            {
              accessRole: "owner",
              accountId,
              calendarId: "forged",
              primary: true,
              timeZone: "UTC",
              title: "Forged",
            },
          ],
        });

        yield* Schema.decodeUnknownEffect(
          Schema.NonEmptyArray(
            Schema.Struct({
              exit: Schema.TaggedStruct("Failure", {}),
            })
          )
        )(document);
        expect(JSON.stringify(document)).toContain("calendars");
      }

      const empty = yield* fixture.send({ ...searchPayload, calendars: [] });
      yield* Schema.decodeUnknownEffect(
        Schema.NonEmptyArray(
          Schema.Struct({
            exit: Schema.TaggedStruct("Failure", {}),
          })
        )
      )(empty);
      expect(fixture.storePeople).toEqual([]);
      expect(yield* Ref.get(fixture.requests)).toEqual([]);
    })
);

it.effect(
  "search RPC cannot use a forged person header without the signed-in session",
  () =>
    Effect.gen(function* anonymousSearch() {
      const fixture = yield* searchRpcFixture();
      const document = yield* fixture.sendAnonymous;

      const failure = (yield* Schema.decodeUnknownEffect(
        rpcFailure(NotConnected)
      )(document))[0].exit.cause[0].error;

      expect(failure).toBeInstanceOf(NotConnected);
      expect(fixture.storePeople).toEqual([]);
      expect(yield* Ref.get(fixture.requests)).toEqual([]);
    })
);
