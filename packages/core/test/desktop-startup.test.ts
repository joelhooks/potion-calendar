import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  DesktopSettings,
  StartupRequest,
  defaultDesktopPreferences,
  desktopWire,
} from "../src/desktop-bridge.js";

it.effect.prop(
  "legacy startup codecs retain enabled without inventing a target or Mac projection",
  { enabled: Schema.Boolean },
  ({ enabled }) =>
    Effect.gen(function* legacyStartupCodec() {
      const request = yield* Schema.decodeEffect(desktopWire.startup)(
        JSON.stringify({ enabled })
      );

      expect(request).toEqual({ enabled });
      const encoded = yield* Schema.encodeEffect(desktopWire.startup)(request);
      expect(JSON.parse(encoded)).toEqual({ enabled });

      const settings = {
        issues: [],
        openAtLogin: enabled,
        preferences: defaultDesktopPreferences(),
        revision: 1,
      };

      expect(yield* Schema.decodeEffect(DesktopSettings)(settings)).toEqual(
        settings
      );
    })
);

it.effect.prop(
  "Mac startup targets and observed projections cross the existing codecs without changing preferences",
  { enabled: Schema.Boolean, target: Schema.Literals(["calendar", "menuBar"]) },
  ({ enabled, target }) =>
    Effect.gen(function* targetedStartupCodec() {
      const request = { enabled, target };
      const encoded = yield* Schema.encodeEffect(desktopWire.startup)(request);
      expect(yield* Schema.decodeEffect(desktopWire.startup)(encoded)).toEqual(
        request
      );
      const preferences = defaultDesktopPreferences();

      const settings = yield* Schema.decodeEffect(DesktopSettings)({
        issues: [],
        macStartup: { calendar: enabled, menuBar: !enabled },
        openAtLogin: true,
        preferences,
        revision: 1,
      });

      expect(settings.macStartup).toEqual({
        calendar: enabled,
        menuBar: !enabled,
      });
      expect(settings.preferences).toEqual(preferences);
      expect(
        (yield* Effect.exit(
          Schema.decodeUnknownEffect(StartupRequest)({
            enabled,
            target: "hidden",
          })
        ))._tag
      ).toBe("Failure");
    })
);
