import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { calendarKey } from "../src/client/calendar-state.js";
import {
  SavedPreferences,
  StoredPreferences,
  normalizePreferences,
} from "../src/client/settings/model.js";
import { VisibilityMigration } from "../src/client/settings/visibility-model.js";

it.effect.prop(
  "legacy hidden choices survive the version-two encoding and reload without a full hidden list",
  { hidden: Schema.Array(Schema.String) },
  ({ hidden }) =>
    Effect.gen(function* legacyCodec() {
      const decoded = yield* Schema.decodeEffect(StoredPreferences)({
        hidden,
        theme: "dark",
        timeFormat: "24",
        version: 1,
      });

      const first = normalizePreferences(decoded);
      expect(first.version).toBe(2);
      expect(first.visibilityMigration).toEqual(
        VisibilityMigration.cases.Legacy.make({})
      );

      const encoded = yield* Schema.encodeEffect(
        Schema.fromJsonString(SavedPreferences)
      )(first);

      const decodedReload = yield* Schema.decodeEffect(
        Schema.fromJsonString(StoredPreferences)
      )(encoded);

      const reloaded = normalizePreferences(decodedReload);
      expect(reloaded).toEqual(first);
      expect(Object.hasOwn(reloaded, "hidden")).toBe(false);
      expect(reloaded.visibility).toEqual(
        Object.fromEntries(hidden.map((key) => [key, false]))
      );
      expect(reloaded.timeFormat).toBe("24");
      expect(reloaded.theme).toBe("dark");
    })
);

it.effect(
  "fresh profiles use Google defaults and version-two explicit shown and hidden values remain distinct",
  () =>
    Effect.sync(() => {
      const fresh = normalizePreferences({ version: 2, visibility: {} });
      expect(fresh.visibility).toEqual({});
      expect(fresh.visibilityMigration).toBeUndefined();

      const stored = normalizePreferences({
        version: 2,
        visibility: {
          [calendarKey("work", "one")]: true,
          [calendarKey("work", "two")]: false,
        },
      });

      expect(stored.visibility).toEqual({
        [calendarKey("work", "one")]: true,
        [calendarKey("work", "two")]: false,
      });
      expect(
        Option.isNone(
          Schema.decodeUnknownOption(StoredPreferences)({
            version: 3,
            visibility: {},
          })
        )
      ).toBe(true);
      expect(
        Option.isNone(
          Schema.decodeUnknownOption(StoredPreferences)({
            version: 2,
            visibility: { bad: "false" },
          })
        )
      ).toBe(true);
    })
);
