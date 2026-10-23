import { Effect, Option, Schema } from "effect";

import { ReminderSnooze } from "./model.js";

const keyFor = (personId: string): string =>
  `calendar.reminder-snoozes.v1.${personId}`;

const decodeRows = Schema.decodeSync(
  Schema.fromJsonString(Schema.Array(Schema.Unknown))
);

const decodeEntry = Schema.decodeUnknownOption(ReminderSnooze);

const encodeEntries = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(ReminderSnooze))
);

const read = (personId: string): readonly (typeof ReminderSnooze.Type)[] => {
  const rows = decodeRows(localStorage.getItem(keyFor(personId)) ?? "[]");

  const entries = rows.flatMap((row) =>
    Option.match(decodeEntry(row, { onExcessProperty: "error" }), {
      onNone: () => [],
      onSome: (entry) => [entry],
    })
  );

  return [...new Map(entries.map((entry) => [entry.identity, entry])).values()];
};

export const restoreReminderSnoozes = Effect.fn("restoreReminderSnoozes")(
  function* restoreReminderSnoozes(personId: string, now: number) {
    return yield* Effect.try(() => {
      const entries = read(personId).filter((entry) => entry.due > now);
      localStorage.setItem(keyFor(personId), encodeEntries(entries));

      return entries;
    });
  }
);

export const saveReminderSnooze = Effect.fn("saveReminderSnooze")(
  function* saveReminderSnooze(
    personId: string,
    entry: typeof ReminderSnooze.Type
  ) {
    const validated = yield* Schema.decodeEffect(ReminderSnooze)(entry);

    return yield* Effect.try(() => {
      const entries = [
        ...read(personId).filter(
          (saved) => saved.identity !== validated.identity
        ),
        validated,
      ];

      localStorage.setItem(keyFor(personId), encodeEntries(entries));
    });
  }
);

export const removeReminderSnoozes = Effect.fn("removeReminderSnoozes")(
  function* removeReminderSnoozes(
    personId: string,
    removed: readonly (typeof ReminderSnooze.Type)[]
  ) {
    return yield* Effect.try(() => {
      const entries = read(personId).filter(
        (entry) =>
          !removed.some(
            (item) => item.identity === entry.identity && item.due === entry.due
          )
      );

      localStorage.setItem(keyFor(personId), encodeEntries(entries));
    });
  }
);
