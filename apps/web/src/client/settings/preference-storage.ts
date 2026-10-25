import { Effect, Schema } from "effect";

import { emptyTimeBlocks } from "../../layout/time-blocks.js";
import {
  SavedPreferences,
  StoredPreferences,
  normalizePreferences,
} from "./model.js";

const preferenceKey = (person: string): string =>
  `calendar.visibility.${person}`;

const decodePreferences = Schema.decodeSync(
  Schema.fromJsonString(StoredPreferences)
);

const encodePreferences = Schema.encodeSync(
  Schema.fromJsonString(SavedPreferences)
);

const read = (person: string): typeof SavedPreferences.Type =>
  normalizePreferences(
    decodePreferences(
      localStorage.getItem(preferenceKey(person)) ??
        '{"version":2,"visibility":{}}'
    )
  );

export const clearPreferences = (person: string) =>
  Effect.try(() => {
    localStorage.removeItem(preferenceKey(person));
  });

export const readPreferences = Effect.fn("readPreferences")(
  function* readPreferences(person: string) {
    return yield* Effect.try(() => read(person));
  }
);

export const modifyPreferences = Effect.fn("modifyPreferences")(
  function* modifyPreferences(
    person: string,
    modify: (
      current: typeof SavedPreferences.Type
    ) => typeof SavedPreferences.Type
  ) {
    return yield* Effect.try(() => {
      const current = read(person);
      const next = modify(current);
      const encoded = encodePreferences(next);
      localStorage.setItem(preferenceKey(person), encoded);

      return next;
    });
  }
);

export const writeGeneralPreferences = Effect.fn("writeGeneralPreferences")(
  function* writeGeneralPreferences(
    person: string,
    preferences: typeof SavedPreferences.Type
  ) {
    return yield* modifyPreferences(person, (current) => ({
      ...preferences,
      customVideoLinks: current.customVideoLinks ?? [],
      timeBlocks:
        preferences.timeBlocks ?? current.timeBlocks ?? emptyTimeBlocks(),
    }));
  }
);
