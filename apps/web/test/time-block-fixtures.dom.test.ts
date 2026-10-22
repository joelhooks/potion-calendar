import { runInNewContext } from "node:vm";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";
import { timeBlockModel } from "./time-block-fixture.js";
import type { TimeBlockScene } from "./time-block-fixture.js";
import { nativeTimeBlockScene } from "./time-block-native.js";
import { timeBlockProofScript } from "./time-block-proof.js";
import type { TimeBlockProof } from "./time-block-proof.js";

it.effect(
  "hidden strip labels follow the same resolved 12-hour, 24-hour and system clock preference as the grid",
  () =>
    Effect.gen(function* stripClockPreference() {
      for (const [timeFormat, system24Hour, label] of [
        ["12", false, "11am–1pm"],
        ["24", false, "11:00–13:00"],
        ["system", true, "11:00–13:00"],
        ["system", false, "11am–1pm"],
      ] as const) {
        const initial = timeBlockModel("day");

        const model = {
          ...initial,
          settings: { ...initial.settings, system24Hour, timeFormat },
        };

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const container = document.createElement("div");
        container.innerHTML = rendered.html;

        const strip = container.querySelector(".time-block-strip");
        expect(strip?.textContent).toBe(`Hidden: Quiet time, Break · ${label}`);
        expect(strip?.getAttribute("aria-label")).toBe(strip?.textContent);
      }
    })
);

const scenes: readonly TimeBlockScene[] = [
  "day",
  "week",
  "14-day",
  "settings-empty",
  "settings-list",
  "settings-edit",
  "settings-error",
];

for (const scene of scenes) {
  for (const width of [900, 1440]) {
    for (const theme of ["light", "dark"] as const) {
      it.effect(
        `exports exact-script Time blocks ${scene} ${theme} ${width}`,
        () =>
          Effect.gen(function* exportTimeBlockScene() {
            const fs = yield* FileSystem.FileSystem;
            const css = yield* fs.readFileString("src/client/style.css");

            const native = scene.startsWith("settings-")
              ? undefined
              : yield* Effect.scoped(nativeTimeBlockScene(scene, width, theme));

            const model = native?.model ?? timeBlockModel(scene, width, theme);

            const proof: TimeBlockProof = {
              endTime: native?.preview.range.endTime ?? "",
              phase: native === undefined ? "settings" : native.phase,
              scale: native?.projection.scale ?? 48,
              scene,
              startTime: native?.preview.range.startTime ?? "",
              steps: native?.steps ?? [],
              theme,
              width,
            };

            if (native !== undefined) {
              expect(native.preview.range).toMatchObject({
                endTime: "16:30",
                startDate: "2026-10-21",
                startTime: "13:30",
              });
              expect(native.completed).toBeUndefined();
            }

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const script = timeBlockProofScript(proof);
            const path = `../../.git/time-block-${scene}-${theme}-${width}-fixture.html`;
            const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${rendered.html}<script>${script}</script></body></html>`;
            const container = document.createElement("div");
            container.innerHTML = html;
            document.body.append(container);
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                container.remove();
              })
            );
            const exactScript = container.querySelector("script")?.textContent;
            expect(exactScript).toBe(script);

            const run = (): void => {
              runInNewContext(
                exactScript ?? "throw new Error('Missing exact script')",
                {
                  document,
                  window: { __timeBlockStandIn: true, innerWidth: width },
                }
              );
            };

            run();
            expect(document.documentElement.dataset.fixtureReady).toBe(
              "time-blocks"
            );
            expect(document.documentElement.dataset.timeBlockProof).toBe(
              "JSDOM stand-in; not browser proof"
            );

            if (native !== undefined) {
              const chip = yield* Effect.fromNullishOr(
                container.querySelector<HTMLElement>(".event-chip.selected")
              );

              const { height } = chip.style;
              chip.style.height = "400px";
              expect(run).toThrow(/chip endpoint difference/u);
              chip.style.height = height;
              run();
            }

            yield* publishFixtureArtifact(path, html);
            expect(yield* fs.readFileString(path)).toBe(html);
          }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
      );
    }
  }
}
