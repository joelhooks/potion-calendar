import { runInNewContext } from "node:vm";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import type { EdgeScene } from "./edge-scroll-fixture.js";
import { nativeEdgeScene } from "./edge-scroll-native.js";
import {
  edgeProofScript,
  edgeProofStandIns,
  edgeStandInStyle,
} from "./edge-scroll-proof.js";
import type { EdgeProof } from "./edge-scroll-proof.js";

const verifyExport = Effect.fn("verifyFrozenEdgeExport")(
  function* verifyFrozenEdgeExport(
    exported: string,
    proof: EdgeProof,
    width: number
  ) {
    const { document } = globalThis;
    const container = document.createElement("div");
    container.innerHTML = exported;
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        document.body.append(container);
      }),
      () =>
        Effect.sync(() => {
          container.remove();
        })
    );
    const exactScript = container.querySelector("script")?.textContent;
    const script = edgeProofScript(proof);

    expect(exactScript).toBe(script);
    edgeProofStandIns(document, proof);
    runInNewContext(exactScript ?? "throw new Error('Missing exact script')", {
      document,
      getComputedStyle: edgeStandInStyle,
      window: { innerWidth: width },
    });
    expect(document.documentElement.dataset.fixtureReady).toBe("edge-scroll");
    expect(document.documentElement.dataset.edgeProof).toContain(
      "JSDOM stand-in"
    );

    const corrupt = script.replace(
      '"actorPhase":"dragging"',
      '"actorPhase":"idle"'
    );

    expect(corrupt).not.toBe(script);
    expect(() => {
      runInNewContext(corrupt, {
        document,
        getComputedStyle: edgeStandInStyle,
        window: { innerWidth: width },
      });
    }).toThrow(/loaded active native snapshot/u);
  }
);

const scenes: readonly EdgeScene[] = [
  "timed-move",
  "all-day-resize",
  "wide-no-overflow",
];

it.effect(
  "exports ten frozen native edge-scroll previews with exact step-driven scripts",
  () =>
    Effect.gen(function* edgeScrollExports() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const scene of scenes) {
        for (const width of scene === "wide-no-overflow"
          ? [1440]
          : [900, 1440]) {
          for (const theme of ["light", "dark"] as const) {
            const result = yield* Effect.scoped(
              nativeEdgeScene({ scene, theme, width })
            );

            expect(result.proof.actorPhase).toBe("dragging");
            expect(result.completed).toBeUndefined();
            expect(result.proof.previewDate).toBe(result.proof.columnDate);

            const rendered = yield* renderToString(
              { init: () => ({ model: result.model }), view },
              { isHydratable: false }
            );

            const script = edgeProofScript(result.proof);
            const path = `../../.git/edge-${scene}-${theme}-${width}-fixture.html`;
            const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${rendered.html}<script>${script}</script></body></html>`;

            yield* fs.writeFileString(path, html);
            const exported = yield* fs.readFileString(path);

            yield* Effect.scoped(verifyExport(exported, result.proof, width));
          }
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
