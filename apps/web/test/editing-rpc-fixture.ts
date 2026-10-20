import {
  CalendarService,
  GoogleCalendarClient,
  createEvent,
  deleteEvent,
  getEvent,
  moveEvent,
  moveAndRetimeSeries,
  rsvp,
  updateEvent,
} from "@calendar/calendar";
import type { GoogleResponse } from "@calendar/calendar";
import { memoryCalendarStore } from "@calendar/calendar/memory";
import { toRpc } from "@calendar/capability/rpc";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import { fakeGoogle } from "../../../packages/calendar/test/fake-google.js";

export const writeBody = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
);

export const editingRpcFixture = Effect.fn("editingRpcFixture")(
  function* editingRpcFixture(responses: readonly GoogleResponse[]) {
    const fake = yield* fakeGoogle(responses);

    const rpc = toRpc([
      createEvent,
      deleteEvent,
      getEvent,
      moveEvent,
      moveAndRetimeSeries,
      rsvp,
      updateEvent,
    ]);

    const calendar = CalendarService.layer.pipe(
      Layer.provide(GoogleCalendarClient.layer),
      Layer.provide(Layer.merge(fake.layer, memoryCalendarStore))
    );

    const backend = yield* Effect.acquireRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(
          RpcServer.layerHttp({
            group: rpc.group,
            path: "/rpc",
            protocol: "http",
          }).pipe(
            Layer.provide(rpc.layer),
            Layer.provide(calendar),
            Layer.provide(RpcSerialization.layerJson)
          ),
          { disableLogger: true }
        )
      ),
      (handler) =>
        Effect.promise(
          // @effect-diagnostics-next-line asyncFunction:off -- Native RPC handler disposal exposes a zero-argument Promise interface.
          async () => {
            await handler.dispose();
          }
        )
    );

    const requests: Request[] = [];

    // @effect-diagnostics-next-line asyncFunction:off -- Native Fetch requires a Promise-returning adapter into the in-memory RPC handler.
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);

      return await backend.handler(request);
    };

    return { fake, fetcher, requests };
  }
);
