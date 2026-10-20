import {
  AccountNotOwned,
  CalendarAppearanceRefused,
  LastCalendarAccount,
  disconnectAccountContract,
  disconnectAccountInstruction,
  DisconnectAccountResult,
  setCalendarAppearanceContract,
} from "@calendar/calendar/contracts";
import { implement } from "@calendar/capability/implement";
import { toRpc } from "@calendar/capability/rpc";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Queue, Result } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import { SettingsManagementClient } from "../src/client/settings-management/client.js";
import {
  ColourTask,
  RemovalTask,
} from "../src/client/settings-management/model.js";

type Mode = "saved" | "colourRefused" | "lastAccount" | "notOwned";

// @effect-diagnostics-next-line asyncFunction:off -- Native Fetch requires a Promise-returning transport rejection fixture.
const failFetch: typeof fetch = async () =>
  await Promise.reject(new Error("private-upstream-detail"));

const rpcFixture = Effect.fn("test.settingsManagementRpc")(function* rpcFixture(
  mode: Mode
) {
  const calls = yield* Queue.unbounded<{
    readonly accountId: string;
    readonly calendarId?: string;
    readonly colorId?: string;
    readonly hidden?: boolean;
    readonly selected?: boolean;
  }>();

  const rpc = toRpc([
    implement(setCalendarAppearanceContract, (input) =>
      Effect.gen(function* colour() {
        yield* Queue.offer(calls, input);

        if (mode === "colourRefused") {
          return yield* new CalendarAppearanceRefused({
            accountId: input.accountId,
            calendarId: input.calendarId,
            reason: "unknownCalendarColor",
          });
        }

        return {
          accessRole: "owner" as const,
          accountId: input.accountId,
          backgroundColor: "#225522",
          calendarId: input.calendarId,
          colorId: input.colorId,
          primary: true,
          selected: true,
          timeZone: "UTC",
          title: "Work",
        };
      })
    ),
    implement(disconnectAccountContract, ({ accountId }) =>
      Effect.gen(function* remove() {
        yield* Queue.offer(calls, { accountId });

        if (mode === "lastAccount") {
          return yield* new LastCalendarAccount({ accountId });
        }

        if (mode === "notOwned") {
          return yield* new AccountNotOwned({ accountId });
        }

        return DisconnectAccountResult.make({
          accountId,
          disconnected: true,
          instruction: disconnectAccountInstruction,
          revocation: "notAttempted",
        });
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

  // @effect-diagnostics-next-line asyncFunction:off -- Native Fetch requires a Promise adapter into the in-memory RPC handler.
  const fetcher: typeof fetch = async (input, init) =>
    await backend.handler(
      new Request(
        input instanceof Request
          ? input
          : new URL(input, "http://calendar.test"),
        init
      )
    );

  return { calls, fetcher };
});

it.effect(
  "the real browser adapter sends only colorId and calendar reference, and removal sends only the account reference",
  () =>
    Effect.gen(function* browserManagement() {
      const fixture = yield* rpcFixture("saved");
      yield* Effect.gen(function* requests() {
        const client = yield* SettingsManagementClient;

        const colour = yield* client.perform(
          ColourTask.make({
            accountId: "work",
            calendarId: "primary",
            colorId: "2",
            personId: "private-ui-scope",
            requestId: 1,
          })
        );

        expect(yield* Queue.take(fixture.calls)).toEqual({
          accountId: "work",
          calendarId: "primary",
          colorId: "2",
        });
        expect(colour).toMatchObject({ calendar: { colorId: "2" } });

        const removed = yield* client.perform(
          RemovalTask.make({
            accountId: "work",
            personId: "private-ui-scope",
            requestId: 2,
          })
        );

        expect(yield* Queue.take(fixture.calls)).toEqual({ accountId: "work" });
        expect(removed).toMatchObject({
          result: {
            instruction: disconnectAccountInstruction,
            revocation: "notAttempted",
          },
        });
      }).pipe(
        Effect.provide(SettingsManagementClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, fixture.fetcher)
      );
    })
);

it.effect.each([
  { kind: "refused", mode: "colourRefused" },
  { kind: "lastAccount", mode: "lastAccount" },
  { kind: "notOwned", mode: "notOwned" },
] as const)(
  "the real RPC path preserves $mode as $kind rather than success",
  ({ mode, kind }) =>
    Effect.gen(function* refusedManagement() {
      const fixture = yield* rpcFixture(mode);
      yield* Effect.gen(function* request() {
        const client = yield* SettingsManagementClient;

        const task =
          mode === "colourRefused"
            ? ColourTask.make({
                accountId: "work",
                calendarId: "primary",
                colorId: "2",
                personId: "person",
                requestId: 1,
              })
            : RemovalTask.make({
                accountId: "work",
                personId: "person",
                requestId: 1,
              });

        const result = yield* client.perform(task).pipe(Effect.result);
        expect(Result.isFailure(result)).toBe(true);

        if (Result.isFailure(result)) {
          expect(result.failure.kind).toBe(kind);
          expect(result.failure.message.length).toBeGreaterThan(0);
        }
      }).pipe(
        Effect.provide(SettingsManagementClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, fixture.fetcher)
      );
    })
);

it.effect(
  "transport rejection is unconfirmed and does not expose upstream details",
  () =>
    Effect.gen(function* transportFailure() {
      const client = yield* SettingsManagementClient;

      const result = yield* client
        .perform(
          RemovalTask.make({
            accountId: "work",
            personId: "person",
            requestId: 1,
          })
        )
        .pipe(Effect.result);

      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure.kind).toBe("unconfirmed");
        expect(result.failure.message).not.toContain("private-upstream-detail");
      }
    }).pipe(
      Effect.provide(SettingsManagementClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, failFetch)
    )
);
