import {
  DesktopPreferences,
  defaultDesktopPreferences,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";

import { StoredDesktopPreferences } from "../src/settings.js";

it.effect("new and legacy desktop preferences default to Blip", () =>
  Effect.gen(function* legacyPreferences() {
    const defaults = defaultDesktopPreferences();

    const legacy = Object.fromEntries(
      Object.entries(defaults).filter(([key]) => key !== "promptSound")
    );

    expect(defaults).toHaveProperty("promptSound", "blip");

    const decoded =
      yield* Schema.decodeUnknownEffect(DesktopPreferences)(legacy);

    expect(decoded).toHaveProperty("promptSound", "blip");

    const stored = yield* Schema.decodeEffect(StoredDesktopPreferences)(
      JSON.stringify({ preferences: legacy, version: 1 })
    );

    expect(stored.preferences).toHaveProperty("promptSound", "blip");
  })
);

it.effect.prop(
  "known sounds round-trip through the actual persisted preference codec",
  {
    sound: Arbitrary.schema(Schema.Literals(["none", "blip", "bell", "tap"])),
  },
  ({ sound }) =>
    Effect.gen(function* persistedSound() {
      const decoded = yield* Schema.decodeEffect(DesktopPreferences)({
        ...defaultDesktopPreferences(),
        promptSound: sound,
      });

      const stored = yield* Schema.encodeEffect(StoredDesktopPreferences)({
        preferences: decoded,
        version: 1,
      });

      const restored = yield* Schema.decodeEffect(StoredDesktopPreferences)(
        stored
      );

      expect(restored.preferences).toHaveProperty("promptSound", sound);
    })
);

it.effect.each(["", "Blip", "ding", "None", null, 1])(
  "unknown sound %s is refused instead of coerced to Blip",
  (promptSound) =>
    Effect.sync(() => {
      expect(
        Option.isNone(
          Schema.decodeUnknownOption(DesktopPreferences)({
            ...defaultDesktopPreferences(),
            promptSound,
          })
        )
      ).toBe(true);
    })
);
