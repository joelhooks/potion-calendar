import { expect, it } from "@effect/vitest";
import { Effect, Option, Predicate, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import { ReadPreferences, SavePreferences } from "../src/client/commands.js";
import { SaveCustomVideoLinks } from "../src/client/settings/conferencing/commands.js";
import {
  ConferencingSettingsChange,
  CustomVideoWrite,
} from "../src/client/settings/conferencing/model.js";
import {
  normalizePreferences,
  SettingsChange,
} from "../src/client/settings/model.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import { TimeBlockPreferences } from "../src/layout/time-blocks.js";
import { timeBlockModel, timeBlockPreferences } from "./time-block-fixture.js";

it.effect(
  "time blocks reload through the existing per-person record and survive ordinary Settings writes without crossing people",
  () =>
    Effect.gen(function* persistTimeBlocks() {
      const first = "time-block-one";
      const second = "time-block-two";

      const preferences = normalizePreferences({
        hidden: [],
        theme: "dark",
        timeBlocks: timeBlockPreferences(),
      });

      const base = {
        ...timeBlockModel("settings-empty"),
        person: Option.some(first),
      };

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          localStorage.removeItem(`calendar.visibility.${first}`);
          localStorage.removeItem(`calendar.visibility.${second}`);
        })
      );
      yield* SavePreferences({ ...preferences, person: first }).effect;

      const loaded = update(
        base,
        yield* ReadPreferences({ person: first }).effect
      ).model;

      expect(loaded.settings.timeBlocks).toEqual(timeBlockPreferences());

      const changed = update(
        loaded,
        Message.ChangedSettings({
          change: SettingsChange.cases.Theme.make({ value: "light" }),
        })
      );

      const expected = preferenceSnapshot(changed.model);

      const save = changed.commands?.find(
        (command) => command.name === "SavePreferences"
      );

      expect(save?.args).toMatchObject({
        person: first,
        timeBlocks: preferences.timeBlocks,
      });
      yield* SavePreferences({ ...expected, person: first }).effect;
      expect(yield* ReadPreferences({ person: first }).effect).toEqual(
        Message.ReceivedPreferences({ person: first, preferences: expected })
      );
      const other = yield* ReadPreferences({ person: second }).effect;
      expect(other).toEqual(
        Message.ReceivedPreferences({
          person: second,
          preferences: normalizePreferences({ version: 2, visibility: {} }),
        })
      );
      expect(
        normalizePreferences({ version: 2, visibility: {} }).timeBlocks
      ).toEqual({ blocks: [], enabled: false });
    }).pipe(Effect.scoped)
);

it.effect(
  "an older general caller that omits timeBlocks preserves current definitions, while an explicit empty list clears them",
  () =>
    Effect.gen(function* optionalBlockWrite() {
      const person = "time-block-legacy-writer";
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          localStorage.removeItem(`calendar.visibility.${person}`);
        })
      );

      const seeded = normalizePreferences({
        timeBlocks: timeBlockPreferences(),
        version: 2,
        visibility: {},
      });

      const { timeBlocks, ...legacy } = seeded;
      yield* SavePreferences({ ...seeded, person }).effect;
      yield* SavePreferences({ ...legacy, person, theme: "dark" }).effect;
      const preserved = yield* ReadPreferences({ person }).effect;

      if (!Predicate.isTagged(preserved, "ReceivedPreferences")) {
        return yield* Effect.die("Expected legacy caller read");
      }

      expect(preserved.preferences.timeBlocks).toEqual(timeBlocks);
      expect(preserved.preferences.theme).toBe("dark");
      yield* SavePreferences({
        ...legacy,
        person,
        timeBlocks: { blocks: [], enabled: false },
      }).effect;
      const cleared = yield* ReadPreferences({ person }).effect;

      if (!Predicate.isTagged(cleared, "ReceivedPreferences")) {
        return yield* Effect.die("Expected explicit clear read");
      }

      expect(cleared.preferences.timeBlocks).toEqual({
        blocks: [],
        enabled: false,
      });

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "stale catalog and block commands retain both owners in both write orders through the one synchronous preference boundary",
  {
    token: Schema.Int.check(Schema.isBetween({ maximum: 100_000, minimum: 0 })),
  },
  ({ token }) =>
    Effect.gen(function* preserveBlocksAndCatalog() {
      for (const catalogFirst of [false, true]) {
        const person = `time-block-catalog-${token}-${catalogFirst}`;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            localStorage.removeItem(`calendar.visibility.${person}`);
          })
        );
        const stale = normalizePreferences({ version: 2, visibility: {} });
        yield* SavePreferences({ ...stale, person }).effect;

        const blocks = TimeBlockPreferences.make({
          blocks: [
            {
              color: "#7d8d85",
              hidden: token % 2 === 0,
              id: token + 1,
              name: `Explicit ${token}`,
              ranges: [{ endMinute: 1440, startMinute: token % 1440 }],
            },
          ],
          enabled: token % 3 !== 0,
        });

        const general = SavePreferences({
          ...stale,
          customVideoLinks: [],
          person,
          theme: "dark",
          timeBlocks: blocks,
        });

        const catalog = SaveCustomVideoLinks({
          personId: person,
          requestId: 1,
          write: CustomVideoWrite.cases.Save.make({
            id: Option.none(),
            link: `https://room${token}.example.test/`,
            name: `Room ${token}`,
          }),
        });

        if (!catalogFirst) {
          yield* general.effect;
        }

        const saved = yield* catalog.effect;

        if (!ConferencingSettingsChange.guards.Saved(saved.change)) {
          return yield* Effect.die("Expected catalog add acknowledgement");
        }

        if (catalogFirst) {
          yield* general.effect;
        }

        const [first] = saved.change.entries;

        if (first === undefined) {
          return yield* Effect.die("Expected saved catalog entry");
        }

        const loaded = yield* ReadPreferences({ person }).effect;

        if (!Predicate.isTagged(loaded, "ReceivedPreferences")) {
          return yield* Effect.die("Expected combined preference read");
        }

        expect(loaded.preferences.timeBlocks).toEqual(blocks);
        expect(loaded.preferences.customVideoLinks).toEqual([first]);
        expect(loaded.preferences.theme).toBe("dark");

        const staleEdit = SaveCustomVideoLinks({
          personId: person,
          requestId: 2,
          write: CustomVideoWrite.cases.Save.make({
            id: Option.some(first.id),
            link: "https://edited.example.test/",
            name: "Edited",
          }),
        });

        const changed = { ...blocks, enabled: !blocks.enabled };
        yield* SavePreferences({ ...stale, person, timeBlocks: changed })
          .effect;
        yield* staleEdit.effect;
        const edited = yield* ReadPreferences({ person }).effect;

        if (!Predicate.isTagged(edited, "ReceivedPreferences")) {
          return yield* Effect.die("Expected edited combined preference read");
        }

        expect(edited.preferences.timeBlocks).toEqual(changed);
        expect(edited.preferences.customVideoLinks).toEqual([
          {
            id: first.id,
            link: "https://edited.example.test/",
            name: "Edited",
          },
        ]);

        const staleRemove = SaveCustomVideoLinks({
          personId: person,
          requestId: 3,
          write: CustomVideoWrite.cases.Remove.make({ id: first.id }),
        });

        yield* SavePreferences({ ...stale, person, timeBlocks: blocks }).effect;
        yield* staleRemove.effect;
        const removed = yield* ReadPreferences({ person }).effect;

        if (!Predicate.isTagged(removed, "ReceivedPreferences")) {
          return yield* Effect.die("Expected removed combined preference read");
        }

        expect(removed.preferences.timeBlocks).toEqual(blocks);
        expect(removed.preferences.customVideoLinks).toEqual([]);
      }

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);
