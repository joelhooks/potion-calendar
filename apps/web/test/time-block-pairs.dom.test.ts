import { runInNewContext } from "node:vm";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";

import { Model } from "../src/client/app.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";
import { GridPairFamily, gridPairModel } from "./time-block-pair-models.js";
import {
  GridPairInput,
  renderFrozenGridPair,
} from "./time-block-pair-render.js";

interface CandidatePair {
  readonly input: typeof GridPairInput.Type;
  readonly inputSha256: string;
  readonly path: string;
  readonly sha256: string;
}

const candidates = new Map<string, CandidatePair>();

const widths = Schema.Literals([900, 1440]);

const themes = Schema.Literals(["light", "dark"]);

for (const family of GridPairFamily.literals) {
  for (const width of widths.literals) {
    for (const theme of themes.literals) {
      it.effect(
        `freezes same-input grid pair candidate ${family} ${theme} ${width}`,
        () =>
          Effect.gen(function* exportCandidatePair() {
            const fs = yield* FileSystem.FileSystem;
            const model = yield* gridPairModel(family, width, theme);

            const encoded = yield* Schema.encodeEffect(
              Schema.fromJsonString(Schema.toCodecJson(Model))
            )(model);

            const input = GridPairInput.make({
              family,
              model: encoded,
              theme,
              width,
            });

            const css = yield* fs.readFileString("src/client/style.css");
            const result = yield* renderFrozenGridPair(input, "candidate", css);
            const container = document.createElement("div");
            container.innerHTML = result.html;
            document.body.append(container);
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                container.remove();
              })
            );
            const exactScript = container.querySelector("script")?.textContent;
            expect(exactScript).toBe(result.script);
            runInNewContext(
              exactScript ?? "throw new Error('Missing pair script')",
              {
                document,
                window: { __timeBlockStandIn: true, innerWidth: width },
              }
            );
            expect(document.documentElement.dataset.timeBlockPairProof).toBe(
              "JSDOM stand-in; not browser proof"
            );
            expect(
              container.querySelector(".time-block-strip,.time-block-fill")
            ).toBeNull();
            const dialogs = [...container.querySelectorAll("dialog")];
            expect(dialogs.every((dialog) => dialog.open)).toBe(true);

            if (dialogs.length > 0) {
              for (const dialog of dialogs) {
                dialog.removeAttribute("open");
              }

              const broken = result.script.replace(
                'if (standIn) dialog.setAttribute("open", "");',
                "if (standIn) {}"
              );

              expect(broken).not.toBe(result.script);
              expect(() => {
                runInNewContext(broken, {
                  document,
                  window: { __timeBlockStandIn: true, innerWidth: width },
                });
              }).toThrow(/native dialog is open before geometry/u);
            }

            candidates.set(`${family}-${theme}-${width}`, {
              input,
              inputSha256: result.inputSha256,
              path: result.path,
              sha256: result.sha256,
            });
          }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
      );
    }
  }
}

it.effect(
  "publishes only this run's complete discovered-grid-family four-combination paired input inventory",
  () =>
    Effect.gen(function* publishGridPairInventory() {
      expect(candidates.size).toBe(
        GridPairFamily.literals.length *
          widths.literals.length *
          themes.literals.length
      );
      const records = [...candidates.values()];
      yield* publishFixtureArtifact(
        "../../.git/time-block-pair-inputs.json",
        `${JSON.stringify(
          records.map((record) => record.input),
          null,
          2
        )}\n`
      );
      yield* publishFixtureArtifact(
        "../../.git/time-block-candidate-manifest.json",
        `${JSON.stringify(
          records.map(({ input, ...record }) => ({
            ...record,
            family: input.family,
            height: 900,
            theme: input.theme,
            width: input.width,
          })),
          null,
          2
        )}\n`
      );
    }).pipe(Effect.provide(NodeServices.layer))
);
