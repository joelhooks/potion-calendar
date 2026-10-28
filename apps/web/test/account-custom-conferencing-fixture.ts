import { Provider } from "@calendar/calendar";
import type { CustomVideoLink } from "@calendar/calendar/contracts";
import {
  CustomVideoLinks,
  CustomVideoReference,
  readCustomVideoLinksContract,
  importCustomVideoLinksContract,
  saveCustomVideoLinkContract,
  removeCustomVideoLinkContract,
} from "@calendar/calendar/contracts";
import { implement } from "@calendar/capability/implement";
import { toRpc } from "@calendar/capability/rpc";
import { Effect, Layer, Option, Ref, Schema } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { RpcServer, RpcSerialization } from "effect/rpc";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { ReadPreferences } from "../src/client/commands.js";
import { RemoteConferencingDefault } from "../src/client/conferencing/model.js";
import { LoadCustomVideoLinks } from "../src/client/settings/conferencing/commands.js";
import type { ConferencingSettings } from "../src/client/settings/conferencing/model.js";
import {
  CustomVideoWrite,
  initialConferencingSettings,
} from "../src/client/settings/conferencing/model.js";
import { view } from "../src/features/app.js";
import { AccountSettingsRoute, SettingsRoute } from "../src/layout/route.js";
import { inheritanceSession } from "./conferencing-inheritance-fixture.js";
import { fixtureModel } from "./fixture.js";

const failure = () =>
  new Provider({
    message: "Planted command transport failure",
    operation: "customVideoLink.fixture",
    status: 409,
  });

export const catalogCommandFixture = Effect.fn("test.catalogCommandFixture")(
  function* catalogCommandFixture() {
    const entries = yield* Ref.make<readonly (typeof CustomVideoLink.Type)[]>(
      []
    );

    const removed = yield* Ref.make<ReadonlySet<string>>(new Set());
    const failBefore = yield* Ref.make(false);

    const loseAck = yield* Ref.make(false);
    const requests: Request[] = [];

    const catalog = () =>
      Ref.get(entries).pipe(
        Effect.map((saved) => ({ conflicts: [], entries: saved }))
      );

    const rpc = toRpc([
      implement(readCustomVideoLinksContract, () => catalog()),
      implement(importCustomVideoLinksContract, (input) =>
        Effect.gen(function* importFixtureLinks() {
          const tombstones = yield* Ref.get(removed);
          yield* Ref.update(entries, (previous) => [
            ...previous,
            ...input.entries.filter(
              (entry) =>
                !tombstones.has(entry.id) &&
                !previous.some((saved) => saved.id === entry.id)
            ),
          ]);

          return yield* catalog();
        })
      ),
      implement(saveCustomVideoLinkContract, (input) =>
        Effect.gen(function* saveFixtureLink() {
          if (yield* Ref.get(failBefore)) {
            return yield* failure();
          }

          const entry = { id: input.id, link: input.link, name: input.name };
          yield* Ref.update(entries, (previous) =>
            previous.some((saved) => saved.id === input.id)
              ? previous.map((saved) => (saved.id === input.id ? entry : saved))
              : [...previous, entry]
          );

          if (yield* Ref.get(loseAck)) {
            return yield* failure();
          }

          return yield* catalog();
        })
      ),
      implement(removeCustomVideoLinkContract, (input) =>
        Effect.gen(function* removeFixtureLink() {
          if (yield* Ref.get(failBefore)) {
            return yield* failure();
          }

          yield* Ref.update(entries, (previous) =>
            previous.filter((entry) => entry.id !== input.id)
          );
          yield* Ref.update(
            removed,
            (previous) => new Set([...previous, input.id])
          );

          if (yield* Ref.get(loseAck)) {
            return yield* failure();
          }

          return yield* catalog();
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

    // @effect-diagnostics-next-line asyncFunction:off -- Native Fetch adapts the actual RPC projection to the command transport fixture.
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);

      return await backend.handler(request);
    };

    return { entries, failBefore, fetcher, loseAck, requests };
  }
);

export const finishCatalogLoad = Effect.fn("test.finishCatalogLoad")(
  function* finishCatalogLoad(
    result: ReturnType<typeof update>,
    fetcher: typeof fetch
  ) {
    const descriptor = result.commands?.find(
      (command) => command.name === LoadCustomVideoLinks.name
    );

    const args = yield* Schema.decodeUnknownEffect(
      Schema.Struct({
        entries: CustomVideoLinks,
        personId: Schema.String,

        requestId: Schema.Int,
      })
    )(descriptor?.args);

    const message = yield* LoadCustomVideoLinks(args).effect.pipe(
      Effect.provideService(FetchHttpClient.Fetch, fetcher)
    );

    return update(result.model, message).model;
  }
);

export const reloadCatalogModel = Effect.fn("test.reloadCatalogModel")(
  function* reloadCatalogModel(model: AppModel, fetcher: typeof fetch) {
    const person = Option.getOrThrow(model.person);

    return yield* finishCatalogLoad(
      update(model, yield* ReadPreferences({ person }).effect),
      fetcher
    );
  }
);

export const customScenes = Schema.Literals([
  "selected",
  "draft",
  "edited",
  "removed",
  "missing",
  "failed",
]);

export const customRoom = {
  id: "account-room",
  link: "https://room.example/team",
  name: "Team room",
};

export const customChoice = CustomVideoReference.make({
  id: customRoom.id,
  kind: "customLink",
});

export const accountCustomModel = (
  scene: typeof customScenes.Type
): AppModel => {
  const base = fixtureModel();

  const entry =
    scene === "edited"
      ? {
          ...customRoom,
          link: "https://room.example/edited",
          name: "Edited room",
        }
      : customRoom;

  const entries = scene === "removed" || scene === "missing" ? [] : [entry];

  const saved = {
    ...initialConferencingSettings(),
    entries,
    legacyEntries: [customRoom],
  };

  const conferencingSettings: typeof ConferencingSettings.Type =
    scene === "failed"
      ? {
          ...saved,
          draft: { ...entry, create: false, id: Option.some(entry.id) },
          error: Option.some(
            "The change could not be confirmed. It may have been saved. Reload to reconcile before retrying."
          ),
          mode: "unconfirmed",
          pendingWrite: Option.some(
            CustomVideoWrite.cases.Save.make({
              ...entry,
              create: false,
              id: Option.some(entry.id),
            })
          ),
          requestId: 3,
        }
      : saved;

  return {
    ...base,
    calendar: {
      ...base.calendar,
      calendars: base.calendar.calendars.map((calendar) => ({
        ...calendar,
        allowedConferenceSolutionTypes: [],
      })),
    },
    conferencing: {
      accounts: {
        work: {
          operation: "read",
          remote: RemoteConferencingDefault.Success({
            data: {
              accountId: "work",
              value: scene === "removed" ? "none" : customChoice,
            },
          }),
          requestId: 1,
        },
      },
      nextRequestId: 1,
    },
    conferencingSettings,
    route:
      scene === "failed"
        ? SettingsRoute.make({ page: "conferencing" })
        : AccountSettingsRoute.make({ accountId: "work" }),
  };
};

export const accountCustomFixture = Effect.fn("test.accountCustomFixture")(
  function* accountCustomFixture(
    scene: typeof customScenes.Type,
    width: number,
    theme: "light" | "dark"
  ) {
    const base = accountCustomModel(scene);

    let { model } = update(
      { ...base, settings: { ...base.settings, theme } },
      Message.MeasuredShellViewport({ width })
    );

    if (scene === "draft") {
      const session = yield* inheritanceSession(model);
      yield* session.add("guest@example.test");
      model = session.get();
      const requests = yield* session.requests();

      if (requests.length !== 0) {
        return yield* Effect.die(
          new Error("A custom proposal wrote before explicit Save")
        );
      }
    }

    const rendered = yield* renderToString(
      { init: () => ({ model }), view },
      { isHydratable: false }
    );

    return {
      evidence: {
        boundary:
          "Actual root and editor actor; supplied catalog/account snapshots. Native RPC, D1 and provider writer are proved separately. Local DOM geometry is not browser proof.",
        entry:
          scene === "edited"
            ? {
                ...customRoom,
                link: "https://room.example/edited",
                name: "Edited room",
              }
            : customRoom,
        legacyEntries: model.conferencingSettings.legacyEntries,
        scene,
        theme,
        width,
      },
      html: rendered.html,
      model,
    };
  }
);
