import { SearchPageTarget } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Ref, Schema } from "effect";

import { SearchResponse } from "../../src/search-contract.js";
import { rpcValue } from "./calendar-rpc.js";
import { searchPayload, searchRpcFixture } from "./search-rpc-fixture.js";

type Fixture = Effect.Success<ReturnType<typeof searchRpcFixture>>;

const readSearch = (fixture: Fixture, payload: Schema.Json = searchPayload) =>
  fixture.send(payload).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(rpcValue(SearchResponse))),
    Effect.map((value) => value[0].exit.value)
  );

it.effect(
  "real search RPC forwards only the requested owned calendar cursor with the original window and server inventory",
  () =>
    Effect.gen(function* ownedPage() {
      const fixture = yield* searchRpcFixture();
      yield* Ref.set(fixture.paginated, true);
      const initial = yield* readSearch(fixture);
      const accountId = fixture.accounts[0].id;
      const calendarId = `calendar-${accountId}`;

      const pageToken = yield* Schema.decodeUnknownEffect(
        Schema.NonEmptyString
      )(
        initial.pageInfo.find((page) => page.accountId === accountId)
          ?.forwardNextPageToken
      );

      expect(pageToken).toBe("provider-page-2");
      yield* Ref.set(fixture.requests, []);

      const page = yield* readSearch(fixture, {
        ...searchPayload,
        continuation: {
          pages: [
            SearchPageTarget.cases.Forward.make({
              accountId,
              calendarId,
              pageToken,
            }),
          ],
          window: initial.window,
        },
      });

      expect(page.window).toEqual(initial.window);
      expect(page.failures).toEqual([]);
      expect(page.accountFailures).toEqual([]);
      expect(page.results.map((row) => row.event.eventId)).toEqual([
        `event-${calendarId}-page-2`,
      ]);
      expect(page.pageInfo).toHaveLength(1);
      expect(page.pageInfo[0]?.forwardNextPageToken).toBeUndefined();
      expect(page.pageInfo[0]?.olderHasMore).toBeUndefined();
      const requests = yield* Ref.get(fixture.requests);

      const events = requests.filter((request) =>
        request.path.includes("/events")
      );

      expect(events).toHaveLength(1);
      expect(events[0]?.accountId).toBe(accountId);
      const url = new URL(events[0]?.path ?? "", "https://fixture.test");
      expect(url.searchParams.get("pageToken")).toBe(pageToken);
      expect(url.searchParams.get("q")).toBe(searchPayload.query);
      expect(url.searchParams.get("maxResults")).toBe("500");
      expect(url.searchParams.get("timeMin")).toBe(initial.window.boundary);
      expect(url.searchParams.get("timeMax")).toBe(initial.window.endExclusive);
      expect(
        requests.filter((request) =>
          request.path.startsWith("/users/me/calendarList")
        )
      ).toHaveLength(3);
      expect(
        fixture.storePeople.every((person) => person === fixture.personId)
      ).toBe(true);
    })
);

it.effect(
  "continuation refs cannot grant access to a foreign account, forged calendar or free-busy calendar through real RPC",
  () =>
    Effect.gen(function* foreignPages() {
      const fixture = yield* searchRpcFixture();
      const initial = yield* readSearch(fixture);
      yield* Ref.set(fixture.requests, []);

      const pages = [
        {
          accountId: fixture.foreignAccountId,
          calendarId: `calendar-${fixture.foreignAccountId}`,
        },
        { accountId: fixture.accounts[0].id, calendarId: "forged" },
        { accountId: fixture.accounts[0].id, calendarId: "free-busy" },
      ].map((ref) =>
        SearchPageTarget.cases.Forward.make({
          ...ref,
          pageToken: "foreign-cursor",
        })
      );

      const result = yield* readSearch(fixture, {
        ...searchPayload,
        continuation: { pages, window: initial.window },
      });

      expect(result.results).toEqual([]);
      expect(result.pageInfo).toEqual([]);
      expect(
        result.failures.map((failure) => [
          failure.accountId,
          failure.calendarId,
        ])
      ).toEqual(pages.map((target) => [target.accountId, target.calendarId]));
      const requests = yield* Ref.get(fixture.requests);
      expect(
        requests.filter((request) => request.path.includes("/events"))
      ).toEqual([]);
      expect(
        requests.some(
          (request) => request.accountId === fixture.foreignAccountId
        )
      ).toBe(false);
    })
);

it.effect(
  "an owned continuation with failed inventory returns explicit failures without falling back to another calendar or reading Google events",
  () =>
    Effect.gen(function* failedPageInventory() {
      const fixture = yield* searchRpcFixture();
      yield* Ref.set(fixture.paginated, true);
      const initial = yield* readSearch(fixture);
      const accountId = fixture.accounts[0].id;
      const calendarId = `calendar-${accountId}`;
      yield* Ref.set(fixture.requests, []);
      yield* Ref.set(fixture.failedInventories, [accountId]);

      const result = yield* readSearch(fixture, {
        ...searchPayload,
        continuation: {
          pages: [
            SearchPageTarget.cases.Forward.make({
              accountId,
              calendarId,
              pageToken: "provider-page-2",
            }),
          ],
          window: initial.window,
        },
      });

      expect(result.results).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.accountId).toBe(accountId);
      expect(result.failures[0]?.calendarId).toBe(calendarId);
      expect(
        result.accountFailures.map((failure) => failure.accountId)
      ).toEqual([accountId]);
      expect(
        (yield* Ref.get(fixture.requests)).filter((request) =>
          request.path.includes("/events")
        )
      ).toEqual([]);
    })
);
