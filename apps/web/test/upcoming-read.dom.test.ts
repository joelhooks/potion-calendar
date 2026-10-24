import { listEventsContract } from "@calendar/calendar/contracts";
import type {
  CalendarRefValue,
  RangeValue,
} from "@calendar/calendar/contracts";
import { implement } from "@calendar/capability/implement";
import { toRpc } from "@calendar/capability/rpc";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Stream } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import { EditingRuntime } from "../src/client/editing/runtime.js";
import { Message } from "../src/client/message.js";
import { SearchRuntime } from "../src/client/search/runtime.js";
import { subscriptions } from "../src/client/subscriptions.js";
import { upcomingStream } from "../src/client/upcoming/read.js";
import { unusedBrowserLayers } from "./browser-runtime-fixture.js";
import {
  upcomingFixture,
  upcomingPerson,
  upcomingResult,
} from "./upcoming-fixture.js";

// oxlint-disable-next-line typescript/promise-function-async -- Fetch refusal is a native Promise fixture, not an async application workflow.
const refusedFetch: typeof fetch = () =>
  Promise.reject(new Error("Fixture connection refused"));

it.effect(
  "one existing listEvents RPC covers the entire selected set without multiplying the service fan-out",
  () =>
    Effect.gen(function* upcomingRpc() {
      const calls: {
        readonly calendars: readonly CalendarRefValue[];
        readonly range: RangeValue;
      }[] = [];

      const rpc = toRpc([
        implement(listEventsContract, (input) =>
          Effect.sync(() => {
            calls.push(input);

            return upcomingResult;
          })
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

      // @effect-diagnostics-next-line asyncFunction:off -- Native Fetch adapts the actual RPC projection without contacting Google or a network server.
      const fetcher: typeof fetch = async (input, init) =>
        await backend.handler(new Request(input, init));

      const model = upcomingFixture();
      const query = Option.getOrThrow(model.upcoming.query);

      const unusedEditing = Effect.die(
        new Error("Upcoming reads must not start editing work")
      );

      const messages = yield* subscriptions.upcoming
        .dependenciesToStream(subscriptions.upcoming.modelToDependencies(model))
        .pipe(
          Stream.runCollect,
          Effect.provideService(FetchHttpClient.Fetch, fetcher),
          Effect.provideService(
            EditingRuntime,
            EditingRuntime.of({
              connect: () => unusedEditing,
              dispatch: () => unusedEditing,
            })
          )
        );

      expect(calls).toEqual([
        { calendars: query.calendars, range: query.range },
      ]);
      expect(messages).toEqual([
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: query.request,
          result: upcomingResult,
        }),
      ]);

      const none = yield* upcomingStream(Option.none()).pipe(
        Stream.runCollect,
        Effect.provideService(FetchHttpClient.Fetch, fetcher)
      );

      expect(none).toEqual([]);
      expect(calls).toHaveLength(1);
    }).pipe(
      Effect.scoped,
      Effect.provide(unusedBrowserLayers),
      Effect.provideService(
        SearchRuntime,
        SearchRuntime.of({
          dispatchPage: () =>
            Effect.die("Upcoming fixture must not page search"),
          observe: () =>
            Stream.die(
              new Error("Upcoming fixture must not start event search")
            ),
          observePages: () =>
            Stream.die("Upcoming fixture must not start search pages"),
        })
      )
    )
);

it.effect(
  "a failed RPC returns a scoped generation failure instead of emitting saved rows",
  () =>
    Effect.gen(function* upcomingRpcFailure() {
      const query = Option.getOrThrow(upcomingFixture().upcoming.query);

      const messages = yield* upcomingStream(Option.some(query)).pipe(
        Stream.runCollect,
        Effect.provideService(FetchHttpClient.Fetch, refusedFetch)
      );

      expect(messages).toEqual([
        Message.FailedUpcoming({
          failure: {
            kind: "retry",
            message: "Google Calendar could not be loaded. Try again.",
          },
          personId: upcomingPerson,
          request: query.request,
        }),
      ]);
    })
);
