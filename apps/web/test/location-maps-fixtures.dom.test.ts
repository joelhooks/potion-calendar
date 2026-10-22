import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { update } from "../src/client/app.js";
import { ReadPreferences } from "../src/client/commands.js";
import { browserMapsPlatform } from "../src/client/settings/maps-platform.js";
import { SavedPreferences } from "../src/client/settings/model.js";
import { view } from "../src/features/app.js";
import { CalendarRoute, SettingsRoute } from "../src/layout/route.js";
import {
  mapsFixture,
  mapsLocationText,
  mapsPlatformScope,
  settleMapsSnapshot,
} from "./location-maps-fixture.js";
import { nativeMapsSettings } from "./location-maps-native.js";
import {
  executeMapsProofWithStandIns,
  locationMapsProofScript,
} from "./location-maps-proof.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

it.effect(
  "exports sixteen saved-preference route snapshots and executes each exact proof, including negative preconditions",
  () =>
    Effect.gen(function* mapsArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const scenario of [
        "apple-settings",
        "apple-details",
        "non-apple",
        "apple-default",
      ] as const) {
        yield* Effect.gen(function* mapsScenario() {
          yield* mapsPlatformScope(
            scenario === "apple-default"
              ? { platform: "MacIntel" }
              : { platform: "MacIntel", userAgentData: { platform: "macOS" } }
          );
          const native = yield* nativeMapsSettings();
          const person = Option.getOrThrow(native.current().person);

          const result =
            scenario === "apple-default"
              ? {
                  restored: settleMapsSnapshot(
                    update(
                      mapsFixture(),
                      yield* ReadPreferences({ person }).effect
                    ).model
                  ),
                  saved: null,
                }
              : yield* native.choose("apple");

          if (scenario === "non-apple") {
            yield* mapsPlatformScope({
              platform: "Win32",
              userAgentData: { platform: "Windows" },
            });
          }

          const visible =
            scenario === "apple-settings" || scenario === "apple-default"
              ? "settings"
              : "calendar";

          const facts = {
            loaded: true,
            location: mapsLocationText,
            normalized: result.restored.settings.locationMaps,
            person,
            platform: browserMapsPlatform(),
            saved:
              result.saved === null
                ? null
                : yield* Schema.decodeEffect(
                    Schema.fromJsonString(SavedPreferences)
                  )(result.saved),
            scenario,
          };

          for (const width of [1440, 900]) {
            for (const theme of ["light", "dark"] as const) {
              const model = {
                ...result.restored,
                calendar: {
                  ...result.restored.calendar,
                  viewport: 844,
                  viewportWidth: width - (width <= 1000 ? 445 : 520),
                },
                settings: { ...result.restored.settings, theme },
              };

              const settings = yield* renderToString(
                {
                  init: () => ({
                    model: {
                      ...model,
                      route: SettingsRoute.make({ page: "general" }),
                    },
                  }),
                  view,
                },
                { isHydratable: false }
              );

              const calendar = yield* renderToString(
                {
                  init: () => ({
                    model: { ...model, route: CalendarRoute.make({}) },
                  }),
                  view,
                },
                { isHydratable: false }
              );

              const evidence = JSON.stringify(facts).replaceAll("<", "\\u003c");
              const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x960"><title>${scenario} ${theme} ${width}</title><style>${css}</style></head><body><section data-maps-surface="settings" ${visible === "settings" ? "" : "hidden"}>${settings.html}</section><section data-maps-surface="calendar" ${visible === "calendar" ? "" : "hidden"}>${calendar.html}</section><script type="application/json" id="maps-evidence">${evidence}</script><script data-maps-proof>${locationMapsProofScript}</script></body></html>`;
              const path = `../../.git/maps-${scenario}-${theme}-${width}-fixture.html`;
              yield* publishFixtureArtifact(path, html);
              const exported = yield* fs.readFileString(path);
              const document = executeMapsProofWithStandIns(exported, width);
              expect(document.documentElement.dataset.mapsProof).toContain(
                '"passed":true'
              );
              const wrong = exported.replace('"loaded":true', '"loaded":false');
              expect(() => executeMapsProofWithStandIns(wrong, width)).toThrow(
                "Missing loaded location precondition"
              );
            }
          }
        }).pipe(Effect.scoped);
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
