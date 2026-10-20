import type { ConferencingDefault } from "@calendar/calendar/contracts";
import { accountConferencingDefaultRepository } from "@calendar/database/account-conferencing-default";
import { expect, layer } from "@effect/vitest";
import { Context, Effect, Layer, Option } from "effect";
import { FetchHttpClient } from "effect/http";
import { AsyncData } from "foldkit";
import { vi } from "vitest";

import { initialModel, update } from "../../src/client/app.js";
import type { AppModel } from "../../src/client/app.js";
import {
  ConferencingChange,
  RemoteConferencingDefault,
} from "../../src/client/conferencing/model.js";
import { changeConferencing } from "../../src/client/conferencing/update.js";
import { DevelopmentRuntime } from "../../src/dev/native-runtime.js";
import { settingsRpcFixture } from "./settings-rpc-fixture.js";

class AccountDefaultRpc extends Context.Service<
  AccountDefaultRpc,
  Effect.Success<typeof settingsRpcFixture>
>()("test/AccountDefaultRpc") {}

const fixture = Layer.effect(AccountDefaultRpc, settingsRpcFixture).pipe(
  Layer.provide(DevelopmentRuntime.layer("http://127.0.0.1:5173"))
);

layer(fixture, { excludeTestServices: true })(
  "account conferencing client",
  (it) => {
    it.effect(
      "unset and explicit choices round-trip through the named commands, real Worker and D1 without local storage or Google setting writes",
      () =>
        Effect.gen(function* realAccountDefault() {
          const account = yield* AccountDefaultRpc;
          const { accountId } = account.target;
          const writes = vi.fn();
          vi.stubGlobal("location", new URL(account.origin));
          vi.stubGlobal("localStorage", { setItem: writes });
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => vi.unstubAllGlobals())
          );

          // @effect-diagnostics-next-line asyncFunction:off -- Native Fetch forwards simulated browser requests to the actual local Worker.
          const fetcher: typeof fetch = async (input, init) => {
            const request = new Request(input, init);
            const headers = new Headers(request.headers);
            headers.set("cookie", account.runtime.person.cookie);
            headers.set("origin", account.origin);
            headers.set("sec-fetch-site", "same-origin");

            const forwarded = new Request(
              `${account.origin}${new URL(request.url).pathname}`,
              request
            );

            return await account.runtime.handle(
              new Request(forwarded, { headers })
            );
          };

          let model: AppModel = {
            ...initialModel(0, "UTC"),
            person: Option.some(account.runtime.person.personId),
          };

          const requested = changeConferencing(
            model,
            ConferencingChange.cases.Load.make({ accountId, refresh: false })
          );

          const command = yield* Effect.fromNullishOr(
            requested.commands?.[0]
          ).pipe(Effect.orDie);

          ({ model } = update(
            requested.model,
            yield* command.effect.pipe(
              Effect.provideService(FetchHttpClient.Fetch, fetcher)
            )
          ));

          const initial = yield* Effect.fromOption(
            AsyncData.getData(
              model.conferencing.accounts[accountId]?.remote ??
                RemoteConferencingDefault.Idle()
            )
          ).pipe(Effect.orDie);

          expect(initial).toEqual({ accountId, value: "unset" });

          const choices = [
            "none",
            "googleMeet",
            "unset",
          ] satisfies readonly (typeof ConferencingDefault.Type)[];

          for (const value of choices) {
            const changed = changeConferencing(
              model,
              ConferencingChange.cases.Set.make({ accountId, value })
            );

            const write = yield* Effect.fromNullishOr(
              changed.commands?.[0]
            ).pipe(Effect.orDie);

            ({ model } = update(
              changed.model,
              yield* write.effect.pipe(
                Effect.provideService(FetchHttpClient.Fetch, fetcher)
              )
            ));

            const stored = yield* accountConferencingDefaultRepository(
              account.runtime.database,
              account.runtime.person.personId
            ).get(accountId);

            const visible = yield* Effect.fromOption(
              AsyncData.getData(
                model.conferencing.accounts[accountId]?.remote ??
                  RemoteConferencingDefault.Idle()
              )
            ).pipe(Effect.orDie);

            expect(stored).toEqual({ accountId, value });
            expect(visible).toEqual(stored);
          }

          expect(writes).not.toHaveBeenCalled();
          expect(
            account.runtime.outboundRequests.filter(
              (request) =>
                request.path.startsWith("/calendar/v3") &&
                ["POST", "PATCH"].includes(request.method) &&
                !request.path.endsWith("/watch")
            )
          ).toEqual([]);
        }).pipe(Effect.scoped)
    );
  }
);
