import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { renderToString } from "foldkit/experimental/server";
import { afterEach, vi } from "vitest";

import { view } from "../src/features/app.js";
import {
  modDeleteArtifactFixture,
  modDeleteScenarios,
} from "./mod-delete-artifact-fixture.js";
import {
  executeModDeleteProofWithStandInBoxes,
  modDeleteProofScript,
} from "./mod-delete-proof.js";

afterEach(() => {
  vi.restoreAllMocks();
});

it.effect.each(modDeleteScenarios)(
  "$0 keeps actual-root staged copy and listings truthful without claiming an email was sent",
  (scenario) =>
    Effect.gen(function* copyScene() {
      vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
      const fixture = yield* modDeleteArtifactFixture(scenario);

      const rendered = yield* renderToString(
        { init: () => ({ model: fixture.model }), view },
        { isHydratable: false }
      );

      const evidence = JSON.stringify(fixture.evidence).replaceAll(
        "<",
        "\\u003c"
      );

      const html = `<html><body>${rendered.html}<script id="mod-delete-evidence" type="application/json">${evidence}</script><script data-mod-delete-proof>${modDeleteProofScript}</script></body></html>`;
      const document = executeModDeleteProofWithStandInBoxes(html, 1440);
      expect(document.documentElement.dataset.modDeleteProof).toBe("pass");

      if (scenario === "catalog") {
        for (const presentation of ["closed", "nonmodal"] as const) {
          expect(() =>
            executeModDeleteProofWithStandInBoxes(html, 1440, presentation)
          ).toThrow("Command dialog is not modal");
        }
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
