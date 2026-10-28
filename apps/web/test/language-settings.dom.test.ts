import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Scene } from "foldkit/test";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import { ReadPreferences, SavePreferences } from "../src/client/commands.js";
import { DispatchEditing } from "../src/client/editing/commands.js";
import { PrepareEditingDialogs } from "../src/client/editing/dialog-mount.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { PrepareKeyboard } from "../src/client/keyboard/mount.js";
import {
  LanguageRefresh,
  LanguageRefreshFailure,
  SaveAppLanguage,
} from "../src/client/settings/language.js";
import { SettingsChange } from "../src/client/settings/model.js";
import {
  modifyPreferences,
  readPreferences,
} from "../src/client/settings/preference-storage.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import { view } from "../src/features/app.js";
import { resolvedAppLocale } from "../src/layout/app-locale.js";
import { languageFixture } from "./language-fixture.js";

const storagePerson = "p71-language-owner";

const otherPerson = "p71-language-other";

const ownStorage = Effect.acquireRelease(
  Effect.sync(() => {
    for (const person of [storagePerson, otherPerson]) {
      expect(localStorage.getItem(`calendar.visibility.${person}`)).toBeNull();
    }
  }),
  () =>
    Effect.sync(() => {
      for (const person of [storagePerson, otherPerson]) {
        localStorage.removeItem(`calendar.visibility.${person}`);
      }
    })
);

it.effect(
  "the actual Language select dispatches only the person-scoped save-and-refresh command",
  () =>
    Effect.sync(() => {
      const model = languageFixture("en-US", "de-DE", "general");
      const person = Option.getOrThrow(model.person);
      Scene.scene(
        { update, view },
        Scene.given(model),
        Scene.Mount.resolve(PrepareKeyboard, Message.KeyboardClose()),
        Scene.Mount.resolve(
          PrepareEditingDialogs,
          Message.EditingAction({ action: EditorAction.cases.Cancel.make({}) })
        ),
        Scene.Command.resolve(DispatchEditing, Message.DispatchedEditing()),
        Scene.expect(Scene.selector("#settings-language")).toHaveValue("en-US"),
        Scene.change(Scene.selector("#settings-language"), "fr-FR"),
        Scene.Command.expectHas(
          SaveAppLanguage({ language: Option.some("fr-FR"), person })
        ),
        Scene.Command.resolve(SaveAppLanguage, Message.SavedPreferences()),
        Scene.expect(Scene.selector("#settings-language")).toHaveValue("en-US")
      );

      const changed = update(
        model,
        Message.ChangedSettings({
          change: SettingsChange.cases.Language.make({
            value: Option.some("fr-FR"),
          }),
        })
      );

      expect(changed.commands?.map((command) => command.name)).toEqual([
        "SaveAppLanguage",
      ]);
      expect(changed.model).toBe(model);
      expect(
        update(
          model,
          Message.ChangedSettings({
            change: SettingsChange.cases.Language.make({
              value: Option.some("en-US"),
            }),
          })
        ).commands
      ).toBeUndefined();
    })
);

it.effect(
  "the real command stores before refresh, survives stale general writes, reloads, isolates people and clears back to browser",
  () =>
    Effect.gen(function* languagePersistence() {
      yield* ownStorage;

      const base = {
        ...languageFixture("en-US", "ja-JP"),
        person: Option.some(storagePerson),
      };

      yield* modifyPreferences(storagePerson, () => preferenceSnapshot(base));
      const writes = vi.spyOn(Storage.prototype, "setItem");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          writes.mockRestore();
        })
      );
      let refreshes = 0;

      const port = {
        refresh: Effect.gen(function* observeStoredBeforeRefresh() {
          expect(writes).toHaveBeenCalledTimes(1);
          expect((yield* readPreferences(storagePerson)).language).toBe(
            "fr-FR"
          );
          refreshes += 1;
        }).pipe(Effect.orDie),
      };

      expect(
        yield* SaveAppLanguage({
          language: Option.some("fr-FR"),
          person: storagePerson,
        }).effect.pipe(Effect.provideService(LanguageRefresh, port))
      ).toEqual(Message.SavedPreferences());
      expect(refreshes).toBe(1);
      expect(writes).toHaveBeenCalledTimes(1);
      writes.mockClear();
      yield* SaveAppLanguage({
        language: Option.some("fr-FR"),
        person: storagePerson,
      }).effect.pipe(Effect.provideService(LanguageRefresh, port));
      expect(writes).not.toHaveBeenCalled();
      expect(refreshes).toBe(1);
      yield* SavePreferences({
        ...preferenceSnapshot(base),
        person: storagePerson,
      }).effect;
      expect((yield* readPreferences(storagePerson)).language).toBe("fr-FR");

      const loaded = update(
        base,
        yield* ReadPreferences({ person: storagePerson }).effect
      ).model;

      expect(resolvedAppLocale(loaded)).toBe("fr-FR");
      expect((yield* readPreferences(otherPerson)).language).toBeUndefined();
      yield* SaveAppLanguage({
        language: Option.none(),
        person: storagePerson,
      }).effect.pipe(
        Effect.provideService(LanguageRefresh, {
          refresh: Effect.sync(() => {
            refreshes += 1;
          }),
        })
      );
      expect((yield* readPreferences(storagePerson)).language).toBeUndefined();
      expect(
        resolvedAppLocale(
          update(
            loaded,
            yield* ReadPreferences({ person: storagePerson }).effect
          ).model
        )
      ).toBe("ja-JP");
      expect(refreshes).toBe(2);
    })
);

it.effect(
  "a quota failure returns a person-scoped error, keeps the saved choice and never refreshes",
  () =>
    Effect.gen(function* blockedLanguageWrite() {
      yield* ownStorage;

      const base = {
        ...languageFixture("en-US", "de-DE"),
        person: Option.some(storagePerson),
      };

      yield* modifyPreferences(storagePerson, () => preferenceSnapshot(base));

      const write = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new DOMException("Quota exceeded", "QuotaExceededError");
        });

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          write.mockRestore();
        })
      );
      let refreshed = false;

      const failure = yield* SaveAppLanguage({
        language: Option.some("fr-FR"),
        person: storagePerson,
      }).effect.pipe(
        Effect.provideService(LanguageRefresh, {
          refresh: Effect.sync(() => {
            refreshed = true;
          }),
        })
      );

      expect(failure).toEqual(
        Message.FailedPreferenceSave({ person: storagePerson })
      );
      expect(refreshed).toBe(false);
      const after = update(base, failure).model;
      expect(resolvedAppLocale(after)).toBe("en-US");
      expect(Option.getOrUndefined(after.error)).toMatch(/could not be saved/u);
      expect((yield* readPreferences(storagePerson)).language).toBe("en-US");
    })
);

it.effect(
  "a refresh failure says the language was saved and keeps the error person-scoped",
  () =>
    Effect.gen(function* blockedLanguageRefresh() {
      yield* ownStorage;

      const base = {
        ...languageFixture("en-US", "de-DE"),
        person: Option.some(storagePerson),
      };

      yield* modifyPreferences(storagePerson, () => preferenceSnapshot(base));

      const failure = yield* SaveAppLanguage({
        language: Option.some("fr-FR"),
        person: storagePerson,
      }).effect.pipe(
        Effect.provideService(LanguageRefresh, {
          refresh: Effect.fail(new LanguageRefreshFailure()),
        })
      );

      expect(failure).toEqual(
        Message.FailedLanguageRefresh({ person: storagePerson })
      );
      expect((yield* readPreferences(storagePerson)).language).toBe("fr-FR");
      expect(Option.getOrUndefined(update(base, failure).model.error)).toMatch(
        /was saved.*could not refresh/u
      );
      const other = { ...base, person: Option.some(otherPerson) };
      expect(update(other, failure).model).toBe(other);
    })
);
