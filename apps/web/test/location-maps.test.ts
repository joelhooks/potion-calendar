import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import {
  normalizePreferences,
  StoredPreferences,
} from "../src/client/settings/model.js";
import { mapsLocation, eventTextLinks } from "../src/layout/event-links.js";
import {
  mapsPlatform,
  effectiveLocationMaps,
} from "../src/layout/location-maps.js";
import { mapsPlatformScope } from "./location-maps-fixture.js";

it.effect.prop(
  "platform precedence uses modern macOS exactly and only Mac-prefixed fallback",
  {
    legacy: Schema.Literals([
      "MacIntel",
      "MacPPC",
      "Win32",
      "Linux",
      "iPad",
      "NotMac",
    ]),
    modern: Schema.Union([
      Schema.Undefined,
      Schema.Literals(["macOS", "Windows", "Linux", "", "macos"]),
    ]),
    saved: Schema.Literals(["apple", "google"]),
  },
  ({ modern, legacy, saved }) =>
    Effect.sync(() => {
      const facts =
        modern === undefined
          ? mapsPlatform({ platform: legacy })
          : mapsPlatform({
              platform: legacy,
              userAgentData: { platform: modern },
            });

      const apple =
        modern === undefined ? legacy.startsWith("Mac") : modern === "macOS";

      expect(facts.apple).toBe(apple);
      expect(facts.source).toBe(
        modern === undefined ? "navigator.platform" : "userAgentData"
      );
      expect(effectiveLocationMaps(saved, facts)).toBe(
        apple ? saved : "google"
      );
    })
);

it.effect.prop(
  "Apple search encodes exactly one documented query and cannot inject parameters or fragments",
  {
    suffix: Schema.String,
  },
  ({ suffix }) =>
    Effect.gen(function* appleQuery() {
      yield* mapsPlatformScope({
        platform: "MacIntel",
        userAgentData: { platform: "macOS" },
      });
      const location = `123 Main Street & #?=${suffix.replaceAll("://", "--")}`;
      const href = mapsLocation(location, "apple");
      const url = new URL(href ?? "https://missing.invalid");

      expect(url.origin).toBe("https://maps.apple.com");
      expect(url.pathname).toBe("/search");
      expect([...url.searchParams.keys()]).toEqual(["query"]);
      expect(url.searchParams.get("query")).toBe(
        location.trim().replaceAll(/[\uD800-\uDFFF]/gu, "\uFFFD")
      );
      expect(url.hash).toBe("");
      expect(url.username).toBe("");
      expect(url.password).toBe("");
    }).pipe(Effect.scoped)
);

it.effect(
  "legacy records default to Google; invalid maps values do not cross the stored schema",
  () =>
    Effect.gen(function* storedMaps() {
      for (const input of [{ hidden: [] }, { version: 2, visibility: {} }]) {
        const decoded =
          yield* Schema.decodeUnknownEffect(StoredPreferences)(input);

        expect(normalizePreferences(decoded).locationMaps).toBe("google");
      }

      const invalid = Schema.decodeUnknownOption(StoredPreferences)({
        locationMaps: "untrusted",
        version: 2,
        visibility: {},
      });

      expect(Option.isNone(invalid)).toBe(true);
    })
);

it.effect(
  "URL-like locations stay ordinary text links under either maps choice",
  () =>
    Effect.gen(function* preserveLinks() {
      yield* mapsPlatformScope({ platform: "MacIntel" });

      for (const choice of ["apple", "google"] as const) {
        for (const text of [
          "",
          "https://example.test/address",
          "mailto:team@example.test",
          "file:///private/path",
        ]) {
          expect(mapsLocation(text, choice)).toBeUndefined();
        }
      }

      expect(eventTextLinks("https://example.test/address")).toEqual([
        {
          href: "https://example.test/address",
          text: "https://example.test/address",
        },
      ]);
    }).pipe(Effect.scoped)
);
