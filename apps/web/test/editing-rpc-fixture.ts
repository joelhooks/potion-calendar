import {
  CalendarService,
  ConferencingDefaults,
  GoogleCalendarClient,
  GoogleHttp,
  Provider,
  createEvent,
  deleteEvent,
  getEvent,
  moveEvent,
  moveAndRetimeSeries,
  rsvp,
  updateEvent,
} from "@calendar/calendar";
import type {
  CustomVideoLink,
  GoogleRequestValue,
  GoogleResponse,
} from "@calendar/calendar";
import { memoryCalendarStore } from "@calendar/calendar/memory";
import { toRpc } from "@calendar/capability/rpc";
import { Deferred, Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import { fakeGoogle } from "../../../packages/calendar/test/fake-google.js";

export const writeBody = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
);

export const editingRpcFixture = Effect.fn("editingRpcFixture")(
  function* editingRpcFixture(
    responses: readonly GoogleResponse[],
    customLinks?: readonly (typeof CustomVideoLink.Type)[]
  ) {
    const fake = yield* fakeGoogle(responses);
    const customWrite = yield* Deferred.make<GoogleRequestValue>();

    const observedHttp = Layer.effect(
      GoogleHttp,
      Effect.gen(function* observedCustomHttp() {
        const http = yield* GoogleHttp;

        return {
          execute: (request: GoogleRequestValue, bearer: string) =>
            http
              .execute(request, bearer)
              .pipe(
                Effect.tap(() =>
                  request.method === "POST"
                    ? Deferred.succeed(customWrite, request)
                    : Effect.void
                )
              ),
        };
      })
    ).pipe(Layer.provide(fake.layer));

    const dependencies =
      customLinks === undefined
        ? Layer.merge(fake.layer, memoryCalendarStore)
        : Layer.mergeAll(fake.layer, memoryCalendarStore, observedHttp);

    const rpc = toRpc([
      createEvent,
      deleteEvent,
      getEvent,
      moveEvent,
      moveAndRetimeSeries,
      rsvp,
      updateEvent,
    ]);

    const sourceCalendar =
      customLinks === undefined
        ? CalendarService.layer
        : CalendarService.layer.pipe(
            Layer.provide(
              Layer.succeed(ConferencingDefaults, {
                forAccount: () => Effect.succeed("unset"),
                resolveCustomLink: (id) => {
                  const link = customLinks.find((entry) => entry.id === id);

                  return link === undefined
                    ? Effect.fail(
                        new Provider({
                          message: "The saved link no longer exists",
                          operation: "customVideoLink.resolve",
                          status: 409,
                        })
                      )
                    : Effect.succeed(link);
                },
              })
            )
          );

    const calendar = sourceCalendar.pipe(
      Layer.provide(GoogleCalendarClient.layer),
      Layer.provide(dependencies)
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

    return customLinks === undefined
      ? { fake, fetcher, requests }
      : { customWrite, fake, fetcher, requests };
  }
);
