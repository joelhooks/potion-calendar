import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import { ReadPreferences, SavePreferences } from "../src/client/commands.js";
import { SaveCustomVideoLinks } from "../src/client/settings/conferencing/commands.js";
import {
  ConferencingSettingsChange as Change,
  CustomVideoWrite,
} from "../src/client/settings/conferencing/model.js";
import { normalizePreferences } from "../src/client/settings/model.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import { fixtureModel } from "./fixture.js";

const decodeSaved = Schema.decodeUnknownSync(Change.cases.Saved);

it.effect.prop(
  "catalog writes preserve current general settings and stale ordinary snapshots preserve the current catalog",
  {
    token: Schema.Int.check(Schema.isBetween({ maximum: 100_000, minimum: 0 })),
  },
  ({ token }) =>
    Effect.gen(function* preserveBothOwners() {
      localStorage.clear();
      const person = `owner-${token}`;

      const oldSnapshot = normalizePreferences({
        theme: "light",
        version: 2,
        visibility: {},
      });

      yield* SavePreferences({ ...oldSnapshot, person }).effect;

      const added = yield* SaveCustomVideoLinks({
        personId: person,
        requestId: 1,
        write: CustomVideoWrite.cases.Save.make({
          id: Option.none(),
          link: `https://room${token}.example/`,
          name: `Room ${token}`,
        }),
      }).effect;

      const [first] = decodeSaved(added.change).entries;
      expect(first).toBeDefined();

      if (first === undefined) {
        throw new Error("Successful add did not contain the saved entry");
      }

      yield* SavePreferences({
        ...oldSnapshot,
        customVideoLinks: [],
        person,
        theme: "dark",
      }).effect;

      const retained = update(
        { ...fixtureModel(), person: Option.some(person) },
        yield* ReadPreferences({ person }).effect
      ).model;

      expect(retained.conferencingSettings.entries).toEqual([first]);

      const edited = yield* SaveCustomVideoLinks({
        personId: person,
        requestId: 2,
        write: CustomVideoWrite.cases.Save.make({
          id: Option.some(first.id),
          link: "http://edited.example/",
          name: "Edited room",
        }),
      }).effect;

      expect(decodeSaved(edited.change).entries).toEqual([
        { id: first.id, link: "http://edited.example/", name: "Edited room" },
      ]);
      const base = { ...fixtureModel(), person: Option.some(person) };

      const loaded = update(
        base,
        yield* ReadPreferences({ person }).effect
      ).model;

      expect(preferenceSnapshot(loaded).theme).toBe("dark");
      expect(loaded.conferencingSettings.entries).toEqual([
        { id: first.id, link: "http://edited.example/", name: "Edited room" },
      ]);
      const stranger = `other-${token}`;

      const isolated = update(
        { ...fixtureModel(), person: Option.some(stranger) },
        yield* ReadPreferences({ person: stranger }).effect
      ).model;

      expect(isolated.conferencingSettings.entries).toEqual([]);
      localStorage.clear();
    })
);

it.effect(
  "real add, duplicate, edit and remove writes reload in insertion order without touching account defaults",
  () =>
    Effect.gen(function* catalogCrud() {
      localStorage.clear();
      const personId = "custom-video-owner";

      const input = {
        id: Option.none<string>(),
        link: "https://same.example/",
        name: "Same name",
      };

      const first = decodeSaved(
        (yield* SaveCustomVideoLinks({
          personId,
          requestId: 1,
          write: CustomVideoWrite.cases.Save.make(input),
        }).effect).change
      ).entries;

      const duplicate = decodeSaved(
        (yield* SaveCustomVideoLinks({
          personId,
          requestId: 2,
          write: CustomVideoWrite.cases.Save.make(input),
        }).effect).change
      ).entries;

      expect(duplicate.map((entry) => entry.name)).toEqual([
        "Same name",
        "Same name",
      ]);
      expect(new Set(duplicate.map((entry) => entry.id)).size).toBe(2);
      expect(duplicate[0]).toEqual(first[0]);
      const [head, tail] = duplicate;

      if (head === undefined || tail === undefined) {
        throw new Error("Duplicate adds did not create two entries");
      }

      const edited = decodeSaved(
        (yield* SaveCustomVideoLinks({
          personId,
          requestId: 3,
          write: CustomVideoWrite.cases.Save.make({
            id: Option.some(head.id),
            link: "https://changed.example/",
            name: "Changed",
          }),
        }).effect).change
      ).entries;

      expect(edited.map((entry) => entry.name)).toEqual([
        "Changed",
        "Same name",
      ]);

      const removed = decodeSaved(
        (yield* SaveCustomVideoLinks({
          personId,
          requestId: 4,
          write: CustomVideoWrite.cases.Remove.make({ id: head.id }),
        }).effect).change
      ).entries;

      expect(removed).toEqual([tail]);

      const reloaded = update(
        { ...fixtureModel(), person: Option.some(personId) },
        yield* ReadPreferences({ person: personId }).effect
      ).model;

      expect(reloaded.conferencingSettings.entries).toEqual([tail]);
      expect(reloaded.conferencing.accounts).toEqual({});
      localStorage.clear();
    })
);

it.effect(
  "a real failed write returns to editing with its draft and does not erase the saved row",
  () =>
    Effect.gen(function* failedCatalogSave() {
      localStorage.clear();
      const personId = "failed-video-owner";

      const saved = decodeSaved(
        (yield* SaveCustomVideoLinks({
          personId,
          requestId: 1,
          write: CustomVideoWrite.cases.Save.make({
            id: Option.none(),
            link: "https://saved.example/",
            name: "Saved",
          }),
        }).effect).change
      ).entries;

      const [entry] = saved;

      if (entry === undefined) {
        throw new Error("Initial save did not produce an entry");
      }

      const base = update(
        { ...fixtureModel(), person: Option.some(personId) },
        yield* ReadPreferences({ person: personId }).effect
      ).model;

      const send = (change: typeof Change.Type) =>
        Message.ChangedConferencingSettings({ change, personId });

      const opened = update(
        base,
        send(Change.cases.Edit.make({ id: entry.id }))
      ).model;

      const typed = update(
        opened,
        send(Change.cases.Name.make({ value: "Unsaved draft" }))
      ).model;

      const pending = update(typed, send(Change.cases.Save.make({}))).model;

      const write = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new Error("storage unavailable");
        });

      yield* Effect.gen(function* verifyFailure() {
        const failed = yield* SaveCustomVideoLinks({
          personId,
          requestId: pending.conferencingSettings.requestId,
          write: CustomVideoWrite.cases.Save.make({
            id: Option.some(entry.id),
            link: entry.link,
            name: "Unsaved draft",
          }),
        }).effect;

        expect(failed.change._tag).toBe("Failed");
        const returned = update(pending, failed).model;
        expect(returned.conferencingSettings.mode).toBe("editing");
        expect(returned.conferencingSettings.draft.name).toBe("Unsaved draft");
        expect(returned.conferencingSettings.entries).toEqual(saved);
        expect(Option.isSome(returned.conferencingSettings.error)).toBe(true);

        const other = {
          ...fixtureModel(),
          person: Option.some("different-person"),
        };

        expect(update(other, failed).model).toEqual(other);
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            write.mockRestore();
          })
        )
      );

      const unchanged = update(
        base,
        yield* ReadPreferences({ person: personId }).effect
      ).model;

      expect(unchanged.conferencingSettings.entries).toEqual(saved);
      localStorage.clear();
    })
);
