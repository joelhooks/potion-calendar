import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

import { Message, update } from "../src/client/app.js";
import { SavePreferences } from "../src/client/commands.js";
import { SaveCustomVideoLinks } from "../src/client/settings/conferencing/commands.js";
import {
  ConferencingSettingsChange as Change,
  CustomVideoWrite,
} from "../src/client/settings/conferencing/model.js";
import { normalizePreferences } from "../src/client/settings/model.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import {
  catalogCommandFixture,
  finishCatalogLoad,
  reloadCatalogModel,
} from "./account-custom-conferencing-fixture.js";
import { fixtureModel } from "./fixture.js";

const save = (
  args: Parameters<typeof SaveCustomVideoLinks>[0],
  fetcher: typeof fetch
) =>
  SaveCustomVideoLinks(args).effect.pipe(
    Effect.provideService(FetchHttpClient.Fetch, fetcher),
    Effect.flatMap((message) =>
      Schema.decodeUnknownEffect(Change.cases.Saved)(message.change)
    )
  );

it.effect.prop(
  "catalog RPC writes preserve legacy local entries and stale general snapshots never copy the D1 catalog into them",
  {
    token: Schema.Int.check(Schema.isBetween({ maximum: 100_000, minimum: 0 })),
  },
  ({ token }) =>
    Effect.gen(function* preserveOwners() {
      const api = yield* catalogCommandFixture();
      const person = `owner-${token}`;
      const key = `calendar.visibility.${person}`;

      const legacy = {
        id: "legacy",
        link: "https://legacy.example/",
        name: "Legacy room",
      };

      localStorage.setItem(
        key,
        JSON.stringify({
          customVideoLinks: [legacy],
          theme: "light",
          version: 2,
          visibility: {},
        })
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          localStorage.removeItem(key);
        })
      );
      const original = localStorage.getItem(key);

      const stale = normalizePreferences({
        theme: "light",
        version: 2,
        visibility: {},
      });

      const added = yield* save(
        {
          personId: person,
          requestId: 1,
          write: CustomVideoWrite.cases.Save.make({
            id: Option.none(),
            link: `https://room${token}.example/`,
            name: `Room ${token}`,
          }),
        },
        api.fetcher
      );

      const first = yield* Effect.fromNullishOr(added.entries[0]).pipe(
        Effect.orDie
      );

      expect(
        localStorage.getItem(key),
        "catalog writes must not rewrite the legacy local import source"
      ).toBe(original);
      yield* SavePreferences({
        ...stale,
        customVideoLinks: [],
        person,
        theme: "dark",
      }).effect;
      const model = { ...fixtureModel(), person: Option.some(person) };
      const loaded = yield* reloadCatalogModel(model, api.fetcher);
      expect(loaded.conferencingSettings.entries).toEqual([first, legacy]);
      expect(loaded.conferencingSettings.legacyEntries).toEqual([legacy]);
      expect(preferenceSnapshot(loaded).theme).toBe("dark");

      const edited = yield* save(
        {
          personId: person,
          requestId: 2,
          write: CustomVideoWrite.cases.Save.make({
            id: Option.some(first.id),
            link: "http://edited.example/",
            name: "Edited room",
          }),
        },
        api.fetcher
      );

      expect(edited.entries).toEqual([
        { id: first.id, link: "http://edited.example/", name: "Edited room" },
        legacy,
      ]);
      const reloaded = yield* reloadCatalogModel(model, api.fetcher);
      expect(reloaded.conferencingSettings.entries).toEqual(edited.entries);
      expect(preferenceSnapshot(reloaded).customVideoLinks).toEqual([legacy]);
      const strangerApi = yield* catalogCommandFixture();

      const stranger = yield* reloadCatalogModel(
        { ...fixtureModel(), person: Option.some(`other-${token}`) },
        strangerApi.fetcher
      );

      expect(stranger.conferencingSettings.entries).toEqual([]);
    })
);

it.effect(
  "real add, duplicate, edit and remove commands reload without writing the legacy source",
  () =>
    Effect.gen(function* catalogCrud() {
      const api = yield* catalogCommandFixture();
      const personId = "custom-video-owner";
      const key = `calendar.visibility.${personId}`;
      localStorage.setItem(
        key,
        JSON.stringify({ customVideoLinks: [], version: 2, visibility: {} })
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          localStorage.removeItem(key);
        })
      );
      const original = localStorage.getItem(key);

      const input = {
        id: Option.none<string>(),
        link: "https://same.example/",
        name: "Same name",
      };

      const first = (yield* save(
        {
          personId,
          requestId: 1,
          write: CustomVideoWrite.cases.Save.make(input),
        },
        api.fetcher
      )).entries;

      const duplicate = (yield* save(
        {
          personId,
          requestId: 2,
          write: CustomVideoWrite.cases.Save.make(input),
        },
        api.fetcher
      )).entries;

      expect(duplicate.map((entry) => entry.name)).toEqual([
        "Same name",
        "Same name",
      ]);
      expect(new Set(duplicate.map((entry) => entry.id)).size).toBe(2);
      expect(duplicate[0]).toEqual(first[0]);
      const head = yield* Effect.fromNullishOr(duplicate[0]).pipe(Effect.orDie);
      const tail = yield* Effect.fromNullishOr(duplicate[1]).pipe(Effect.orDie);

      const edited = yield* save(
        {
          personId,
          requestId: 3,
          write: CustomVideoWrite.cases.Save.make({
            id: Option.some(head.id),
            link: "https://changed.example/",
            name: "Changed",
          }),
        },
        api.fetcher
      );

      expect(edited.entries.map((entry) => entry.name)).toEqual([
        "Changed",
        "Same name",
      ]);

      const removed = yield* save(
        {
          personId,
          requestId: 4,
          write: CustomVideoWrite.cases.Remove.make({ id: head.id }),
        },
        api.fetcher
      );

      expect(removed.entries).toEqual([tail]);

      const reloaded = yield* reloadCatalogModel(
        { ...fixtureModel(), person: Option.some(personId) },
        api.fetcher
      );

      expect(reloaded.conferencingSettings.entries).toEqual([tail]);
      expect(reloaded.conferencing.accounts).toEqual({});
      expect(
        localStorage.getItem(key),
        "catalog CRUD must leave the legacy local source byte-identical"
      ).toBe(original);
    })
);

it.effect(
  "an unconfirmed command preserves its draft and person fence until explicit reconciliation restores editing",
  () =>
    Effect.gen(function* failedSave() {
      const api = yield* catalogCommandFixture();
      const personId = "failed-video-owner";

      const saved = (yield* save(
        {
          personId,
          requestId: 1,
          write: CustomVideoWrite.cases.Save.make({
            id: Option.none(),
            link: "https://saved.example/",
            name: "Saved",
          }),
        },
        api.fetcher
      )).entries;

      const entry = yield* Effect.fromNullishOr(saved[0]).pipe(Effect.orDie);

      const model = yield* reloadCatalogModel(
        { ...fixtureModel(), person: Option.some(personId) },
        api.fetcher
      );

      const send = (change: typeof Change.Type) =>
        Message.ChangedConferencingSettings({ change, personId });

      const opened = update(
        model,
        send(Change.cases.Edit.make({ id: entry.id }))
      ).model;

      const typed = update(
        opened,
        send(Change.cases.Name.make({ value: "Unsaved draft" }))
      ).model;

      const pending = update(typed, send(Change.cases.Save.make({}))).model;
      yield* Ref.set(api.failBefore, true);

      const failed = yield* SaveCustomVideoLinks({
        personId,
        requestId: pending.conferencingSettings.requestId,
        write: CustomVideoWrite.cases.Save.make({
          id: Option.some(entry.id),
          link: entry.link,
          name: "Unsaved draft",
        }),
      }).effect.pipe(Effect.provideService(FetchHttpClient.Fetch, api.fetcher));

      expect(failed.change._tag).toBe("Unconfirmed");
      const returned = update(pending, failed).model;
      expect(returned.conferencingSettings.mode).toBe("unconfirmed");
      expect(returned.conferencingSettings.draft.name).toBe("Unsaved draft");
      expect(returned.conferencingSettings.entries).toEqual(saved);
      expect(Option.isSome(returned.conferencingSettings.error)).toBe(true);

      const other = {
        ...fixtureModel(),
        person: Option.some("different-person"),
      };

      expect(update(other, failed).model).toEqual(other);
      yield* Ref.set(api.failBefore, false);

      const reconciled = yield* finishCatalogLoad(
        update(returned, send(Change.cases.Load.make({}))),
        api.fetcher
      );

      expect(reconciled.conferencingSettings.mode).toBe("editing");
      expect(reconciled.conferencingSettings.draft.name).toBe("Unsaved draft");
      expect(reconciled.conferencingSettings.entries).toEqual(saved);
    })
);
