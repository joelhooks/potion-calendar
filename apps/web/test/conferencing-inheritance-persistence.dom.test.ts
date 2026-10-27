import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import { ReadPreferences, SavePreferences } from "../src/client/commands.js";
import { SaveCustomVideoLinks } from "../src/client/settings/conferencing/commands.js";
import { UserDefaultConferencing } from "../src/client/settings/conferencing/default.js";
import {
  ConferencingSettingsChange as Change,
  CustomVideoWrite,
} from "../src/client/settings/conferencing/model.js";
import { readPreferences } from "../src/client/settings/preference-storage.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import {
  inheritanceModel,
  persistInheritanceChoice,
} from "./conferencing-inheritance-fixture.js";

const storedDefault = Schema.fromJsonString(
  Schema.Struct({
    defaultConferencing: Schema.optionalKey(
      Schema.NullOr(Schema.Literal("googleMeet"))
    ),
  })
);

it.effect(
  "the existing person preference writer retains a user Meet default",
  () =>
    Effect.gen(function* preserveUserDefault() {
      const person = "inheritance-red-owner";
      const key = `calendar.visibility.${person}`;
      localStorage.setItem(
        key,
        JSON.stringify({
          defaultConferencing: "googleMeet",
          version: 2,
          visibility: {},
        })
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          localStorage.removeItem(key);
        })
      );

      const preferences = yield* readPreferences(person);
      yield* SavePreferences({ ...preferences, person, theme: "dark" }).effect;

      const saved = yield* Schema.decodeUnknownEffect(storedDefault)(
        localStorage.getItem(key)
      );

      expect(saved.defaultConferencing).toBe("googleMeet");
    })
);

it.effect.prop(
  "default writes and stale general or catalog writes preserve each owner's committed fields",
  {
    user: UserDefaultConferencing,
  },
  ({ user }) =>
    Effect.gen(function* preferenceOwners() {
      const before = yield* inheritanceModel(
        user === null ? "googleMeet" : null
      );

      const personId = Option.getOrThrow(before.person);
      const stale = preferenceSnapshot(before);

      const initialStored = yield* readPreferences(personId);

      const pending = update(
        before,
        Message.ChangedConferencingSettings({
          change: Change.cases.Default.make({ value: user }),
          personId,
        })
      );

      expect(pending.model.conferencingSettings.defaultConferencing).toBe(
        stale.defaultConferencing
      );
      expect(pending.model.conferencingSettings.mode).toBe("savingDefault");

      const saved = update(
        pending.model,
        yield* persistInheritanceChoice(pending)
      ).model;

      expect(saved.conferencingSettings.defaultConferencing).toBe(user);
      expect(yield* readPreferences(personId)).toEqual({
        ...initialStored,
        defaultConferencing: user,
      });
      expect(saved.conferencing.accounts).toEqual(before.conferencing.accounts);
      yield* SavePreferences({ ...stale, person: personId, theme: "dark" })
        .effect;

      let current = update(
        saved,
        yield* ReadPreferences({ person: personId }).effect
      ).model;

      for (const change of [
        Change.cases.Add.make({}),
        Change.cases.Name.make({ value: "Room" }),
        Change.cases.Link.make({ value: "https://room.example/" }),
      ]) {
        current = update(
          current,
          Message.ChangedConferencingSettings({ change, personId })
        ).model;
        expect(current.conferencingSettings.defaultConferencing).toBe(user);
      }

      const catalog = update(
        current,
        Message.ChangedConferencingSettings({
          change: Change.cases.Save.make({}),
          personId,
        })
      );

      const command = catalog.commands?.find(
        (item) => item.name === SaveCustomVideoLinks.name
      );

      expect(command).toBeDefined();

      const args = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          personId: Schema.String,
          requestId: Schema.Int,
          write: CustomVideoWrite,
        })
      )(command?.args);

      const listed = update(
        catalog.model,
        yield* SaveCustomVideoLinks(args).effect
      ).model;

      expect(listed.conferencingSettings.defaultConferencing).toBe(user);
      expect(listed.conferencingSettings.mode).toBe("listing");
      expect(listed.conferencingSettings.entries).toHaveLength(1);

      const reloaded = update(
        listed,
        yield* ReadPreferences({ person: personId }).effect
      ).model;

      expect(reloaded.conferencingSettings.defaultConferencing).toBe(user);
      expect(reloaded.conferencingSettings.entries).toEqual(
        listed.conferencingSettings.entries
      );
      expect(reloaded.settings.theme).toBe("dark");
      expect(preferenceSnapshot(reloaded).zones).toEqual(stale.zones);
      expect(preferenceSnapshot(reloaded).timeBlocks).toEqual(stale.timeBlocks);
      expect(
        (yield* readPreferences("other-inheritance-person")).defaultConferencing
      ).toBeNull();
    })
);

it.effect(
  "a real failed default write keeps the previous committed choice and an explicit retry can save",
  () =>
    Effect.gen(function* failedDefaultWrite() {
      const base = yield* inheritanceModel(null);
      const personId = Option.getOrThrow(base.person);

      const change = Message.ChangedConferencingSettings({
        change: Change.cases.Default.make({ value: "googleMeet" }),
        personId,
      });

      const pending = update(base, change);

      const write = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new Error("Storage unavailable");
        });

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          write.mockRestore();
        })
      );

      const failed = yield* persistInheritanceChoice(pending);
      write.mockRestore();

      const returned = update(pending.model, failed).model;

      expect(returned.conferencingSettings.defaultConferencing).toBeNull();
      expect(returned.conferencingSettings.mode).toBe("listing");
      expect(Option.isSome(returned.conferencingSettings.defaultError)).toBe(
        true
      );
      expect(Option.isNone(returned.conferencingSettings.pendingDefault)).toBe(
        true
      );
      expect((yield* readPreferences(personId)).defaultConferencing).toBeNull();

      const retry = update(returned, change);

      const accepted = update(
        retry.model,
        yield* persistInheritanceChoice(retry)
      ).model;

      expect(accepted.conferencingSettings.defaultConferencing).toBe(
        "googleMeet"
      );
      expect(Option.isNone(accepted.conferencingSettings.defaultError)).toBe(
        true
      );
      expect((yield* readPreferences(personId)).defaultConferencing).toBe(
        "googleMeet"
      );
    })
);

it.effect(
  "an unreadable preference document is not replaced by a default write",
  () =>
    Effect.gen(function* unreadableDefault() {
      const base = yield* inheritanceModel(null);
      const personId = Option.getOrThrow(base.person);
      const key = `calendar.visibility.${personId}`;
      localStorage.setItem(key, "{unreadable");

      const pending = update(
        base,
        Message.ChangedConferencingSettings({
          change: Change.cases.Default.make({ value: "googleMeet" }),
          personId,
        })
      );

      const failed = update(
        pending.model,
        yield* persistInheritanceChoice(pending)
      ).model;

      expect(failed.conferencingSettings.defaultConferencing).toBeNull();
      expect(Option.isSome(failed.conferencingSettings.defaultError)).toBe(
        true
      );
      expect(localStorage.getItem(key)).toBe("{unreadable");
    })
);

it.effect(
  "replayed real persistence results cannot settle a newer request or a signed-out person",
  () =>
    Effect.gen(function* staleDefaultResults() {
      const base = yield* inheritanceModel(null);
      const personId = Option.getOrThrow(base.person);

      const choose = (value: typeof UserDefaultConferencing.Type) =>
        Message.ChangedConferencingSettings({
          change: Change.cases.Default.make({ value }),
          personId,
        });

      const first = update(base, choose("googleMeet"));

      const oldResult = yield* persistInheritanceChoice(first);

      const accepted = update(first.model, oldResult).model;
      const second = update(accepted, choose(null));

      const cleared = update(
        second.model,
        yield* persistInheritanceChoice(second)
      ).model;

      const newer = update(cleared, choose("googleMeet"));

      expect(newer.model.conferencingSettings.mode).toBe("savingDefault");
      expect(update(newer.model, oldResult).model).toEqual(newer.model);

      const signedOut = update(
        newer.model,
        Message.ReceivedSession({ snapshot: null })
      ).model;

      expect(Option.isNone(signedOut.person)).toBe(true);
      expect(signedOut.conferencingSettings.defaultConferencing).toBeNull();
      expect(update(signedOut, oldResult).model).toEqual(signedOut);
      expect(update(signedOut, choose("googleMeet")).model).toEqual(signedOut);
      expect(update(signedOut, choose("googleMeet")).commands ?? []).toEqual(
        []
      );
    })
);
