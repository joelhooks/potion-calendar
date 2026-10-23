import { runInNewContext } from "node:vm";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { monthInitialPosition } from "../src/client/month/host.js";
import { view } from "../src/features/app.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";
import { rsvpChipFixture, rsvpScenes } from "./rsvp-chip-fixture.js";
import { rsvpChipProofScript } from "./rsvp-chip-proof.js";

for (const scene of rsvpScenes) {
  it.effect(`exports RSVP ${scene.mode} ${scene.theme} ${scene.width}`, () =>
    Effect.gen(function* exportRsvpStatus() {
      const model = rsvpChipFixture(scene);

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      const script = rsvpChipProofScript({
        ...scene,
        monthScrollTop:
          scene.mode === "month"
            ? monthInitialPosition(model).scrollTop
            : undefined,
      });

      const name = `${scene.mode}-${scene.theme}-${scene.width}`;
      const html = `<!doctype html><html data-fixture-kind="rsvp-chips"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>P19 ${name}</title><style>${css}</style></head><body>${rendered.html}<script>${script}</script></body></html>`;
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const exact = parsed.querySelector("script")?.textContent;
      expect(exact).toBe(script);
      runInNewContext(
        exact ?? "throw new Error('Missing exact proof script')",
        { document: parsed, window: { __JSDOM_STAND_IN__: true } }
      );
      expect(parsed.documentElement.dataset.fixtureReady).toBe("rsvp-chips");
      expect(parsed.documentElement.dataset.rsvpProof).toBe(
        "JSDOM stand-in; not browser proof"
      );
      expect(
        parsed.querySelector<HTMLElement>(
          scene.mode === "month" ? "#month-viewport" : "#time-viewport"
        )?.scrollTop
      ).toBe(
        scene.mode === "month" ? monthInitialPosition(model).scrollTop : 384
      );

      return yield* publishFixtureArtifact(
        `../../.git/rsvp-chip-${name}-fixture.html`,
        html
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
}
