import {
  listEventsContract,
  syncNowContract,
} from "@calendar/calendar/contracts";
import { implement } from "@calendar/capability/implement";
import { toRpc } from "@calendar/capability/rpc";
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import { Message, update } from "../src/client/app.js";
import { EditingRuntime } from "../src/client/editing/runtime.js";
import { LiveNotice } from "../src/client/live/protocol.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { unusedClipboardLayer } from "./clipboard-unused-fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";

it.effect(
  "R syncs each account's calendars before reading while live pushes only read",
  () =>
    Effect.gen(function* refreshOrdering() {
      const calls: {
        readonly accountId: string;
        readonly operation: "sync" | "read";
      }[] = [];

      const rpc = toRpc([
        implement(syncNowContract, ({ accountId }) =>
          Effect.sync(() => {
            calls.push({ accountId, operation: "sync" });

            return { changed: 0, cursor: "fixture", version: 1 };
          })
        ),
        implement(listEventsContract, ({ calendars }) =>
          Effect.sync(() => {
            for (const { accountId } of calendars.slice(0, 1)) {
              calls.push({ accountId, operation: "read" });
            }

            return { events: [], versions: [] };
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

      // @effect-diagnostics-next-line asyncFunction:off -- Native Fetch requires a Promise-returning adapter into the in-memory RPC handler.
      const fetcher: typeof fetch = async (input, init) =>
        await backend.handler(new Request(input, init));

      const unexpectedEditing = Effect.die(
        new Error("refresh must not invoke editing resources")
      );

      const editing = EditingRuntime.of({
        connect: () => unexpectedEditing,
        dispatch: () => unexpectedEditing,
      });

      const model = keyboardFixture();

      const forced = update(
        model,
        Message.PressedCalendarKey({
          alt: false,
          key: "r",
          mod: false,
          now: 1,
          shift: false,
        })
      );

      expect(forced.commands?.length).toBeGreaterThan(0);
      expect(forced.commands?.map((command) => command.name)).toEqual(
        update(model, Message.ClickedRefresh()).commands?.map(
          (command) => command.name
        )
      );

      for (const command of forced.commands ?? []) {
        expect(command.name).toBe("RefreshEvents");

        const result = yield* command.effect.pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetcher),
          Effect.provideService(EditingRuntime, editing)
        );

        expect(result._tag).toBe("ReceivedEvents");
      }

      expect(calls.length).toBeGreaterThan(0);

      for (const accountId of new Set(calls.map((call) => call.accountId))) {
        const accountCalls = calls.flatMap((call) =>
          call.accountId === accountId ? [call.operation] : []
        );

        expect(accountCalls.length).toBeGreaterThan(1);
        expect(accountCalls.at(-1)).toBe("read");
        expect(
          accountCalls.slice(0, -1).every((operation) => operation === "sync")
        ).toBe(true);
      }

      calls.length = 0;

      const passive = update(
        model,
        Message.ReceivedLive({
          notice: LiveNotice.cases.CalendarChanged.make({
            change: {
              accountId: "work",
              calendarId: "primary",
              reason: "sync",
              version: 1,
            },
          }),
          personId: "fixture-person",
        })
      );

      expect(passive.commands?.length).toBeGreaterThan(0);

      for (const command of passive.commands ?? []) {
        expect(command.name).toBe("ReadEvents");

        const result = yield* command.effect.pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetcher),
          Effect.provideService(EditingRuntime, editing)
        );

        expect(result._tag).toBe("ReceivedEvents");
      }

      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every((call) => call.operation === "read")).toBe(true);
    }).pipe(
      Effect.scoped,
      Effect.provide(unusedClipboardLayer),
      Effect.provideService(CalendarSearchClient, unexpectedSearchClient)
    )
);
