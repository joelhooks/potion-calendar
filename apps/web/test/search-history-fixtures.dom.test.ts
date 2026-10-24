import { runInNewContext } from "node:vm";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";
import { vi } from "vitest";

import { view } from "../src/features/app.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";
import {
  searchHistoryFixture,
  searchHistoryScenes,
} from "./search-history-fixture.js";
import { searchHistoryProofScript } from "./search-history-proof.js";

interface HistoryProofEvidence {
  afterOffset: number;
  afterScrollTop: number;
  geometry: string;
  horizon: string | null;
  rows: number;
  scene: string;
}

interface ProofWindow {
  __loadSearchHistory?: () => Promise<HistoryProofEvidence>;
  __searchHistoryReady?: boolean;
  __searchHistoryStandIn: boolean;
}

const executeStandInProof = (html: string, width: number, broken: boolean) =>
  Effect.gen(function* executeHistoryProof() {
    const document = new DOMParser().parseFromString(html, "text/html");
    Object.defineProperty(document.documentElement, "scrollWidth", {
      configurable: true,
      value: width,
    });
    const window: ProofWindow = { __searchHistoryStandIn: true };

    const script = document.querySelector(
      "script[data-search-history-proof]"
    )?.textContent;

    if (script === undefined || script === null) {
      throw new Error("Missing exact exported search history script");
    }

    const execution: unknown = runInNewContext(
      broken ? script.replace("restore(document,latest);", "") : script,
      {
        document,
        innerWidth: width,
        requestAnimationFrame: (onFrame: () => void) => {
          onFrame();

          return 1;
        },
        window,
      }
    );

    // oxlint-disable-next-line typescript/promise-function-async -- Effect owns the exact exported VM script's native Promise boundary and discards its result.
    yield* Effect.promise(() => Promise.resolve(execution)).pipe(Effect.asVoid);
    expect(window.__searchHistoryReady).toBe(true);
    const load = window.__loadSearchHistory;

    if (load === undefined) {
      throw new Error("The exact proof did not expose its history arrival");
    }

    yield* Effect.tryPromise(load);
    expect(document.documentElement.dataset.searchHistoryProof).toBe(
      "stand-in"
    );

    return document;
  });

for (const scene of searchHistoryScenes) {
  it.effect(
    `exports windowed search ${scene.scene} ${scene.theme} ${scene.width} with exact anchor functions and explicit stand-in geometry`,
    () =>
      Effect.gen(function* searchHistoryArtifact() {
        const fs = yield* FileSystem.FileSystem;
        const { after, pending } = searchHistoryFixture(scene);

        const first = yield* renderToString(
          { init: () => ({ model: pending }), view },
          { isHydratable: false }
        );

        const next = yield* renderToString(
          { init: () => ({ model: after }), view },
          { isHydratable: false }
        );

        const parsed = new DOMParser().parseFromString(next.html, "text/html");
        const afterResults = parsed.querySelector("#search-results");
        expect(afterResults).not.toBeNull();

        if (scene.scene === "horizon") {
          expect(
            afterResults?.querySelector("[data-search-history-horizon]")
              ?.textContent
          ).toBe("Searched back to Oct 2016");
        }

        const css = yield* fs.readFileString("src/client/style.css");

        const evidence = JSON.stringify({
          ...scene,
          afterRows: scene.scene === "horizon" ? 20 : 23,
        }).replaceAll("<", "\\u003c");

        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>P29 ${scene.scene}</title><style>${css}</style></head><body>${first.html}<template id="search-history-after">${afterResults?.outerHTML}</template><script type="application/json" id="search-history-evidence">${evidence}</script><script data-search-history-proof>${searchHistoryProofScript}</script></body></html>`;
        const path = `../../.git/search-history-${scene.scene}-${scene.theme}-${scene.width}-fixture.html`;
        yield* publishFixtureArtifact(path, html);
        expect(yield* fs.readFileString(path)).toBe(html);

        const geometry = vi
          .spyOn(HTMLElement.prototype, "getBoundingClientRect")
          .mockImplementation(function rect(this: HTMLElement) {
            if (this.id === "search-results") {
              return new DOMRect(0, 100, scene.width, 600);
            }

            const viewport = this.closest<HTMLElement>("#search-results");

            const topHeight =
              (viewport?.querySelector("[data-search-history-controls]")
                ?.childElementCount ?? 0) * 30;

            if (
              this.matches("[data-search-history-controls]") &&
              viewport !== null
            ) {
              return new DOMRect(
                0,
                100 - viewport.scrollTop,
                scene.width,
                topHeight
              );
            }

            if (this.matches("[data-search-event]") && viewport !== null) {
              const index = [
                ...viewport.querySelectorAll("[data-search-event]"),
              ].indexOf(this);

              return new DOMRect(
                0,
                100 + topHeight + index * 100 - viewport.scrollTop,
                scene.width,
                60
              );
            }

            return new DOMRect(0, 0, scene.width, 60);
          });

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            geometry.mockRestore();
          })
        );
        const document = yield* executeStandInProof(html, scene.width, false);
        expect(
          document.querySelectorAll("#search-results [data-search-event]")
        ).toHaveLength(scene.scene === "horizon" ? 20 : 23);

        const rejected = yield* executeStandInProof(
          html,
          scene.width,
          true
        ).pipe(Effect.flip);

        expect(String(rejected.cause)).toContain(
          "Older arrival shifted the visible row"
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
}
