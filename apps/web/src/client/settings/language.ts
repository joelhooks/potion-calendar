import { Context, Effect, Option, Schema, Struct } from "effect";
import { Command } from "foldkit";

import { AppLanguage } from "../../layout/app-locale.js";
import { Message } from "../message.js";
import { modifyPreferences, readPreferences } from "./preference-storage.js";

export class LanguageRefreshFailure extends Schema.TaggedError<LanguageRefreshFailure>()(
  "LanguageRefreshFailure",
  {}
) {}

export interface LanguageRefreshService {
  readonly refresh: Effect.Effect<void, LanguageRefreshFailure>;
}

export const LanguageRefresh = Context.Reference<LanguageRefreshService>(
  "@calendar/web/settings/LanguageRefresh",
  {
    defaultValue: () => ({
      refresh: Effect.try({
        catch: () => new LanguageRefreshFailure(),
        try: () => {
          window.location.reload();
        },
      }),
    }),
  }
);

export const saveLanguageAndRefresh = Effect.fn("saveLanguageAndRefresh")(
  function* saveLanguageAndRefresh(
    person: string,
    language: Option.Option<typeof AppLanguage.Type>
  ) {
    const next = Option.getOrUndefined(language);
    const stored = yield* readPreferences(person);

    if (stored.language === next) {
      return;
    }

    yield* modifyPreferences(person, (current) => {
      const base = Struct.omit(current, ["language"]);

      return next === undefined ? base : { ...base, language: next };
    });

    const port = yield* LanguageRefresh;
    yield* port.refresh;
  }
);

export const SaveAppLanguage = Command.define("SaveAppLanguage", {
  args: { language: Schema.Option(AppLanguage), person: Schema.String },
  execute: ({ language, person }) =>
    saveLanguageAndRefresh(person, language).pipe(
      Effect.match({
        onFailure: (error) =>
          Schema.is(LanguageRefreshFailure)(error)
            ? Message.FailedLanguageRefresh({ person })
            : Message.FailedPreferenceSave({ person }),
        onSuccess: () => Message.SavedPreferences(),
      })
    ),
  messages: [
    Message.SavedPreferences,
    Message.FailedPreferenceSave,
    Message.FailedLanguageRefresh,
  ],
});
