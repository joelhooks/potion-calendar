import { runInNewContext } from "node:vm";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { compactSceneModel } from "./compact-timed-fixture.js";
import type { CompactScene } from "./compact-timed-fixture.js";
import { compactResize } from "./compact-timed-native.js";
import { compactProofScript } from "./compact-timed-proof.js";

const scenes: readonly CompactScene[] = [
  "short-pair",
  "boundary",
  "overlap",
  "resize",
];

it.effect(
  "exports sixteen actual-root scenes with exact layout proof scripts and released native resize scopes",
  () =>
    Effect.gen(function* compactExports() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      let count = 0;

      for (const scene of scenes) {
        for (const theme of ["light", "dark"] as const) {
          for (const width of [900, 1440]) {
            const base = compactSceneModel(scene, width, theme);

            const native =
              scene === "resize"
                ? yield* Effect.scoped(compactResize(base))
                : undefined;

            const model = native?.model ?? base;

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const proof =
              native === undefined
                ? { scene, theme, width }
                : { native: native.proof, scene, theme, width };

            const script = compactProofScript(proof);
            const path = `../../.git/compact-timed-${scene}-${theme}-${width}-fixture.html`;
            yield* fs.writeFileString(
              path,
              `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${rendered.html}<script>${script}</script></body></html>`
            );
            const saved = yield* fs.readFileString(path);

            const document = new DOMParser().parseFromString(
              saved,
              "text/html"
            );

            expect(document.querySelector("script")?.textContent).toBe(script);
            expect(
              document.querySelectorAll(".day-column .event-chip")
            ).toHaveLength(2);
            expect(document.querySelectorAll(".gesture-preview")).toHaveLength(
              scene === "resize" ? 1 : 0
            );

            if (native !== undefined) {
              expect(native.proof.endTime).toBe("09:15");
              expect(() => {
                runInNewContext(
                  compactProofScript({
                    ...proof,
                    native: { ...native.proof, actorPhase: "idle" },
                  }),
                  { document: {} }
                );
              }).toThrow("Native resize must be dragging");
            }

            count += 1;
          }
        }
      }

      expect(count).toBe(16);
    }).pipe(Effect.provide(NodeServices.layer))
);
