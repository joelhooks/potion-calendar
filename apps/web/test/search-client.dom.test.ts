import { listEventsContract } from "@calendar/calendar/contracts";
import { implement } from "@calendar/capability/implement";
import { toRpc } from "@calendar/capability/rpc";
import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Fiber, Layer, Queue } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import { CalendarSearchClient } from "../src/client/search/client.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { searchEventsContract } from "../src/search-contract.js";
import { searchResponse } from "./search-fixture.js";

const rpcFixture = Effect.fn("test.searchRpcFixture")(function* rpcFixture(
  pending: boolean
) {
  const calls = yield* Queue.unbounded<{
    readonly calendars: readonly {
      readonly accountId: string;
      readonly calendarId: string;
    }[];
    readonly range: { readonly start: string; readonly end: string };
  }>();

  const requested = yield* Queue.unbounded<true>();
  const aborted = yield* Queue.unbounded<boolean>();
  const queries = yield* Queue.unbounded<string>();

  const rpc = toRpc([
    implement(searchEventsContract, ({ query }) =>
      Queue.offer(queries, query).pipe(
        Effect.andThen(
          pending ? Effect.never : Effect.succeed(searchResponse())
        )
      )
    ),
    implement(listEventsContract, (input) =>
      Queue.offer(calls, input).pipe(Effect.as({ events: [], versions: [] }))
    ),
  ]);

  const backend = yield* Effect.acquireRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        RpcServer.layerHttp({
          group: rpc.group,
          path: "/rpc",
          protocol: "http",
        }).pipe(
          Layer.provide(rpc.layer),
          Layer.provide(RpcSerialization.layerJson)
        ),
        { disableLogger: true }
      )
    ),
    (handler) => Effect.promise(handler.dispose.bind(handler))
  );

  // @effect-diagnostics-next-line asyncFunction:off -- Native Fetch requires a Promise adapter into the in-memory RPC handler.
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(
      input instanceof Request ? input : new URL(input, "http://calendar.test"),
      init
    );

    Queue.offerUnsafe(requested, true);
    request.signal.addEventListener(
      "abort",
      () => {
        Queue.offerUnsafe(aborted, request.signal.aborted);
      },
      { once: true }
    );

    return await backend.handler(request);
  };

  return { aborted, calls, fetcher, queries, requested };
});

it.effect(
  "the browser adapter uses the public search contract unchanged and warms the selected primary-zone date",
  () =>
    Effect.gen(function* browserRpc() {
      const fixture = yield* rpcFixture(false);
      const query = "Design + planning owner@example.test";
      yield* Effect.gen(function* calls() {
        const client = yield* CalendarSearchClient;

        const response = yield* client.search({
          query,
          timeZone: "America/Los_Angeles",
          weekStartsOn: 0,
        });

        expect(response).toEqual(searchResponse());
        expect(yield* Queue.take(fixture.queries)).toBe(query);
        yield* client.prefetch({
          calendar: { accountId: "work", calendarId: "primary" },
          day: dayFromIso("2026-11-01"),
          timeZone: "America/Los_Angeles",
        });
        const prefetched = yield* Queue.take(fixture.calls);
        expect(prefetched.calendars).toEqual([
          { accountId: "work", calendarId: "primary" },
        ]);
        expect(
          DateTime.formatIso(DateTime.makeUnsafe(prefetched.range.start))
        ).toBe("2026-11-01T07:00:00.000Z");
        expect(
          DateTime.formatIso(DateTime.makeUnsafe(prefetched.range.end))
        ).toBe("2026-11-02T08:00:00.000Z");
      }).pipe(
        Effect.provide(CalendarSearchClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, fixture.fetcher)
      );
    })
);

it.effect(
  "interrupting a pending browser search aborts its real RPC Fetch request",
  () =>
    Effect.gen(function* abortRpc() {
      const fixture = yield* rpcFixture(true);
      yield* Effect.gen(function* pendingSearch() {
        const client = yield* CalendarSearchClient;

        const fiber = yield* client
          .search({
            query: "pending",
            timeZone: "America/Los_Angeles",
            weekStartsOn: 0,
          })
          .pipe(Effect.forkChild);

        yield* Queue.take(fixture.requested);
        yield* Queue.take(fixture.queries);
        yield* Fiber.interrupt(fiber);
        expect(yield* Queue.take(fixture.aborted)).toBe(true);
      }).pipe(
        Effect.provide(CalendarSearchClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, fixture.fetcher)
      );
    })
);
