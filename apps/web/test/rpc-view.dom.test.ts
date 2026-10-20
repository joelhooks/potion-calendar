import {
  CalendarService,
  GoogleCalendarClient,
  listCalendars,
  listEvents,
} from "@calendar/calendar";
import { memoryCalendarStore } from "@calendar/calendar/memory";
import { implement } from "@calendar/capability/implement";
import { toRpc } from "@calendar/capability/rpc";
import { sessionContract } from "@calendar/core/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { AsyncData } from "foldkit";
import { renderToString } from "foldkit/experimental/server";

import {
  fakeGoogle,
  response,
  timedEvent,
} from "../../../packages/calendar/test/fake-google.js";
import { Message, initialModel, update } from "../src/client/app.js";
import { ReadCalendars } from "../src/client/commands.js";
import { view } from "../src/features/app.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { fixtureModel } from "./fixture.js";

it.effect(
  "the Foldkit UI reads the shared RPC contract through the memory store and fake provider",
  () =>
    Effect.gen(function* rpcUi() {
      const fake = yield* fakeGoogle(
        [
          response(200, { calendar: {}, event: {} }),
          response(200, {
            items: [
              {
                accessRole: "owner",
                backgroundColor: "#4986E8",
                id: "primary",
                primary: true,
                summary: "Work",
                timeZone: "America/Los_Angeles",
              },
            ],
          }),
          response(400, { error: { message: "Provider unavailable" } }),
          response(200, {
            items: [
              timedEvent("a-review", "Product review", {
                end: { dateTime: "2026-10-19T10:00:00-07:00" },
                start: { dateTime: "2026-10-19T09:00:00-07:00" },
              }),
              timedEvent("b-design", "Design session", {
                end: { dateTime: "2026-10-19T10:00:00-07:00" },
                start: { dateTime: "2026-10-19T09:00:00-07:00" },
              }),
            ],
          }),
        ],
        [
          { disconnected: false, email: "owner@example.test", id: "work" },
          { disconnected: true, email: "revoked@example.test", id: "revoked" },
          { disconnected: false, email: "down@example.test", id: "down" },
        ]
      );

      const snapshot = Option.getOrNull(
        AsyncData.getData(fixtureModel().session)
      );

      const session = implement(sessionContract, () =>
        Effect.succeed(snapshot)
      );

      const rpc = toRpc([session, listCalendars, listEvents]);

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
        (handler) => Effect.promise(handler.dispose.bind(handler))
      );

      // @effect-diagnostics-next-line asyncFunction:off -- The native Fetch boundary requires a Promise-returning callback into the in-memory handler.
      const fetcher: typeof fetch = async (input, init) =>
        await backend.handler(new Request(input, init));

      const received = yield* ReadCalendars().effect.pipe(
        Effect.provideService(FetchHttpClient.Fetch, fetcher)
      );

      let { model } = update(
        initialModel(fixtureModel().calendar.now, "America/Los_Angeles"),
        received
      );

      const requested = update(model, Message.CalendarChanged());
      ({ model } = requested);

      for (const command of requested.commands ?? []) {
        const message = yield* command.effect.pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetcher)
        );

        ({ model } = update(model, message));
      }

      expect(visibleEvents(model).map((event) => event.title)).toEqual([
        "Product review",
        "Design session",
      ]);
      const index = AsyncData.getData(model.calendar.index);
      expect(
        Option.isSome(index) &&
          index.value.accounts.some(
            (account) => account.accountId === "revoked" && "failure" in account
          )
      ).toBe(true);
      expect(
        Option.isSome(index) &&
          index.value.accounts.some(
            (account) => account.accountId === "down" && "failure" in account
          )
      ).toBe(true);
      const withSession = { ...model, session: fixtureModel().session };

      const rendered = yield* renderToString(
        { init: () => ({ model: withSession }), view },
        { isHydratable: false }
      );

      expect(rendered.html).toContain("Product review");
      expect(rendered.html).toContain("75%");
      expect(rendered.html).toContain("Reconnect");
    }).pipe(Effect.scoped)
);
