import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import type { AppModel } from "../src/client/app.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { SavedPreferences } from "../src/client/settings/model.js";
import { view } from "../src/features/app.js";
import { CalendarRoute, SettingsRoute } from "../src/layout/route.js";
import { editorDraft, editorViewFields } from "./editor-fixture.js";
import {
  mapsPlatformScope,
  mapsFixture,
  mapsLocationText,
} from "./location-maps-fixture.js";
import { nativeMapsSettings } from "./location-maps-native.js";

it.effect(
  "native General choice persists through SavePreferences and reloads through ReadPreferences",
  () =>
    Effect.gen(function* nativePersistence() {
      yield* mapsPlatformScope({
        platform: "MacIntel",
        userAgentData: { platform: "macOS" },
      });
      const h = yield* nativeMapsSettings();
      expect(h.current().settings.locationMaps).toBe("google");

      for (const value of ["apple", "google", "apple"] as const) {
        const result = yield* h.choose(value);
        expect(result.restored.settings.locationMaps).toBe(value);

        const stored = yield* Schema.decodeEffect(
          Schema.fromJsonString(SavedPreferences)
        )(result.saved ?? "{}");

        expect(stored.locationMaps).toBe(value);
        expect(h.current().settings.locationMaps).toBe(value);

        const details = yield* renderToString(
          { init: () => ({ model: result.restored }), view },
          { isHydratable: false }
        );

        const doc = new DOMParser().parseFromString(details.html, "text/html");

        const prefix =
          value === "apple"
            ? "https://maps.apple.com/search?query="
            : "https://www.google.com/maps/search/?api=1&query=";

        const link = doc.querySelector<HTMLAnchorElement>(
          '.detail-panel a[href^="https://maps.apple.com/"], .detail-panel a[href^="https://www.google.com/maps/"]'
        );

        expect(link?.href).toBe(
          `${prefix}${encodeURIComponent(mapsLocationText)}`
        );
      }
    }).pipe(Effect.scoped)
);

it.effect(
  "non-Apple hides the row and forces Google without erasing a saved Apple choice",
  () =>
    Effect.gen(function* nonAppleSurface() {
      yield* mapsPlatformScope({
        platform: "MacIntel",
        userAgentData: { platform: "Windows" },
      });
      const base = mapsFixture();

      const model: AppModel = {
        ...base,
        settings: { ...base.settings, locationMaps: "apple" },
      };

      const settings = yield* renderToString(
        {
          init: () => ({
            model: { ...model, route: SettingsRoute.make({ page: "general" }) },
          }),
          view,
        },
        { isHydratable: false }
      );

      expect(settings.html).not.toContain("settings-location-maps");

      const details = yield* renderToString(
        {
          init: () => ({ model: { ...model, route: CalendarRoute.make({}) } }),
          view,
        },
        { isHydratable: false }
      );

      const doc = new DOMParser().parseFromString(details.html, "text/html");

      const link = [...doc.querySelectorAll(".detail-panel a")].find(
        (node) => node.textContent === "Open in Google Maps ↗"
      );

      expect(link?.getAttribute("href")).toBe(
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsLocationText)}`
      );
      expect(
        doc.querySelector('.detail-panel a[href="https://example.test/notes"]')
      ).not.toBeNull();
      expect(model.settings.locationMaps).toBe("apple");
    }).pipe(Effect.scoped)
);

it.effect(
  "the persisted Apple choice reaches the editor links through the actual app projection",
  () =>
    Effect.gen(function* editorMaps() {
      yield* mapsPlatformScope({ platform: "MacIntel" });
      const native = yield* nativeMapsSettings();
      const { restored } = yield* native.choose("apple");

      const model: AppModel = {
        ...restored,
        editing: {
          ...restored.editing,
          view: EditorView.cases.Editing.make({
            ...editorViewFields,
            draft: { ...editorDraft, location: mapsLocationText },
          }),
        },
      };

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const doc = new DOMParser().parseFromString(rendered.html, "text/html");

      const link = doc.querySelector<HTMLAnchorElement>(
        '#event-links a[href^="https://maps.apple.com/"]'
      );

      expect(link?.href).toBe(
        `https://maps.apple.com/search?query=${encodeURIComponent(mapsLocationText)}`
      );
      expect(link?.textContent).toBe("Open in Apple Maps ↗");
      expect(link?.target).toBe("_blank");
      expect(link?.rel).toBe("noopener noreferrer");
    }).pipe(Effect.scoped)
);
