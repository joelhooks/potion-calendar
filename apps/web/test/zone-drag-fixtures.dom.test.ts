import { runInNewContext } from "node:vm";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";
import { nativeZoneDragScene } from "./zone-drag-native-fixture.js";
import { zoneDragProofScript } from "./zone-drag-proof.js";

for (const phase of ["marker", "drop"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [900, 1440]) {
      it.effect(`exports actual native zone ${phase} ${theme} ${width}`, () =>
        Effect.gen(function* zoneDragArtifact() {
          const native = yield* nativeZoneDragScene(phase, width, theme);
          expect(native.capturedDuringDrag).toBe(true);
          expect(native.saves).toBe(phase === "drop" ? 1 : 0);
          expect(Option.isSome(native.model.timeZones.drag)).toBe(
            phase === "marker"
          );
          expect(native.model.timeZones.preferences.primary.id).toBe(
            "America/Los_Angeles"
          );
          expect(Option.getOrThrow(native.model.timeZones.temporary).id).toBe(
            "Asia/Tokyo"
          );
          expect(native.model.calendar.zone).toBe("Asia/Tokyo");

          const rendered = yield* renderToString(
            { init: () => ({ model: native.model }), view },
            { isHydratable: false }
          );

          const fs = yield* FileSystem.FileSystem;
          const css = yield* fs.readFileString("src/client/style.css");
          const script = zoneDragProofScript(phase, width);
          const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${rendered.html}<script>${script}</script></body></html>`;

          const parsed = new DOMParser().parseFromString(html, "text/html");
          const exact = parsed.querySelector("script")?.textContent;
          expect(exact).toBe(script);
          runInNewContext(exact ?? "throw new Error('Missing proof script')", {
            document: parsed,
            window: { __zoneDragStandIn: true, innerWidth: width },
          });
          expect(parsed.documentElement.dataset.fixtureReady).toBe("zone-drag");
          expect(parsed.documentElement.dataset.zoneDragProof).toBe(
            "JSDOM stand-in; not browser proof"
          );

          return yield* publishFixtureArtifact(
            `../../.git/zone-drag-${phase}-${theme}-${width}-fixture.html`,
            html
          );
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
      );
    }
  }
}
