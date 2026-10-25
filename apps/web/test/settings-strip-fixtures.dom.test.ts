import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { view } from "../src/features/app.js";
import { printRoute } from "../src/layout/route.js";
import { conferencingSettingsFixture } from "./conferencing-settings-fixture.js";
import { profileFixture } from "./profile-fixture.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";
import { settingsStripProof } from "./settings-strip-proof.js";

for (const page of ["profile", "conferencing"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 430]) {
      it.effect(
        `exports P42 ${page} ${theme} ${width} with the actual strip observer and containment proof`,
        () =>
          Effect.gen(function* settingsStripFixture() {
            const { model: base } =
              page === "profile"
                ? { model: profileFixture() }
                : conferencingSettingsFixture("list");

            const { model } = update(
              {
                ...base,
                calendar: { ...base.calendar, viewportWidth: width },
                settings: { ...base.settings, theme },
              },
              Message.MeasuredShellViewport({ width })
            );

            const route = printRoute(model.route);
            expect(route).toBe(`/settings/${page}`);
            const fs = yield* FileSystem.FileSystem;
            const css = yield* fs.readFileString("src/client/style.css");

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const root = new DOMParser().parseFromString(
              rendered.html,
              "text/html"
            );

            expect(root.querySelector("#phone-settings-dialog")).not.toBeNull();
            expect(
              root
                .querySelector('.settings-nav a[aria-current="page"]')
                ?.getAttribute("href")
            ).toBe(route);
            expect(root.querySelector("img")).toBeNull();

            const evidence = {
              page,
              presentation:
                "Staged actual root. The native dialog opens for capture; the exact production strip observer runs in the browser. Actor, route and open/page-change wiring are tested separately.",
              route,
              theme,
              width,
            };

            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="fixture-viewport" content="${width}x900"><title>P42 ${page} ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="settings-strip-evidence">${JSON.stringify(evidence)}</script><script type="application/json" id="settings-strip-geometry">{}</script><script data-settings-strip-proof>${settingsStripProof}</script></body></html>`;
            const directory = "../../.rat/settings-strip/ui";
            yield* fs.makeDirectory(directory, { recursive: true });
            const file = `${directory}/${page}-${theme}-${width}.html`;
            yield* publishFixtureArtifact(file, html);
            expect(yield* fs.readFileString(file)).toBe(html);
          }).pipe(Effect.provide(NodeServices.layer))
      );
    }
  }
}
