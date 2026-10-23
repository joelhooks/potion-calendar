import {
  listEventsContract,
  syncNowContract,
} from "@calendar/calendar/contracts";
import { implement } from "@calendar/capability/implement";
import { toRpc } from "@calendar/capability/rpc";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Match, Option } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { renderToString } from "foldkit/experimental/server";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppMessage } from "../src/client/app.js";
import { EditingRuntime } from "../src/client/editing/runtime.js";
import { observeKeyboard } from "../src/client/keyboard/input.js";
import { LiveNotice } from "../src/client/live/protocol.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { view } from "../src/features/app.js";
import { unusedBrowserLayers } from "./browser-runtime-fixture.js";
import { editingFixture } from "./editor-fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";

it.effect.each([
  { kind: "plain", platform: "Win32" },
  { kind: "dialog", platform: "MacIntel" },
  { kind: "title", platform: "MacIntel" },
  { kind: "title", platform: "Win32" },
  { kind: "editor", platform: "MacIntel" },
  { kind: "editor", platform: "Win32" },
])(
  "native refresh syncs each account before reading while live pushes only read: %j",
  ({ kind, platform }) =>
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

      const base = keyboardFixture();

      const model = Match.value(kind).pipe(
        Match.when("editor", () => ({
          ...base,
          editing: {
            ...base.editing,
            owner: base.person,
            view: editingFixture,
          },
        })),
        Match.when("plain", () => base),
        Match.orElse(
          () => update(base, Message.KeyboardAction({ id: "commands" })).model
        )
      );

      const spy = vi
        .spyOn(navigator, "platform", "get")
        .mockReturnValue(platform);

      const host = document.createElement("div");
      document.body.append(host);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          spy.mockRestore();
          host.remove();
        })
      );

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      host.innerHTML = rendered.html;

      const selector = Match.value(kind).pipe(
        Match.when("editor", () => "#event-title"),
        Match.when("title", () => "#keyboard-query"),
        Match.when("dialog", () => "#keyboard-command-dialog"),
        Match.orElse(() => "#time-viewport")
      );

      const target = yield* Effect.fromNullishOr(
        host.querySelector<HTMLElement>(selector)
      );

      const received: AppMessage[] = [];
      host.addEventListener(
        "keydown",
        (event) => {
          const message = observeKeyboard(model, event, model.calendar.now);

          if (Option.isSome(message)) {
            received.push(message.value);
          }
        },
        { once: true }
      );

      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: kind !== "plain",
        key: "r",
      });

      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(received).toHaveLength(1);

      const forced = update(
        model,
        Option.getOrThrow(Option.fromUndefinedOr(received[0]))
      );

      expect(forced.commands ?? []).not.toHaveLength(0);
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
        base,
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
      Effect.provide(unusedBrowserLayers),
      Effect.provideService(CalendarSearchClient, unexpectedSearchClient)
    )
);
