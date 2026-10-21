import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Crypto, Effect, FileSystem } from "effect";

import {
  renderStatusRoot,
  statusFidelityScenes,
} from "./status-fidelity-fixture.js";
import {
  executeStatusFidelityProofWithStandInBoxes,
  statusFidelityProofScript,
} from "./status-fidelity-proof.js";
import { statusFidelityScene } from "./status-fidelity-scene.js";

interface ExportedStatusFixture {
  readonly path: string;
  readonly sha256: string;
  readonly scene: string;
  readonly width: number;
  readonly theme: string;
}

const combinations = [
  [1440, "light"],
  [1440, "dark"],
  [900, "light"],
  [900, "dark"],
] as const;

const fixtureSets = new Map<string, readonly ExportedStatusFixture[]>();

it.effect.each(combinations)(
  "exports five source-first status fidelity scenes at %s in %s and executes their exact panel-bound proofs",
  ([width, theme]) =>
    Effect.gen(function* exportStatusFidelity() {
      const fs = yield* FileSystem.FileSystem;
      const crypto = yield* Crypto.Crypto;
      const css = yield* fs.readFileString("src/client/style.css");
      const fixtures: ExportedStatusFixture[] = [];

      for (const scene of statusFidelityScenes) {
        const prepared = yield* statusFidelityScene(scene);
        expect(prepared.evidence.calendar.accountId).toBe("account");
        expect(prepared.evidence.calendar.calendarId).toBe("calendar");
        expect(prepared.evidence.calendar.accessRole).toBe("owner");
        expect(prepared.evidence.source.organizer?.self).toBe(true);
        expect(prepared.evidence.source.eventType).toBe(
          scene.startsWith("ooo") ? "outOfOffice" : "focusTime"
        );

        const model = {
          ...prepared.model,
          calendar: {
            ...prepared.model.calendar,
            viewportWidth: width - (width <= 1000 ? 445 : 520),
          },
          settings: { ...prepared.model.settings, theme },
        };

        const rendered = yield* renderStatusRoot(model);
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>Status fidelity ${scene} ${theme}</title><style>${css}</style></head><body>${rendered.html}<script id="status-fidelity-evidence" type="application/json">${JSON.stringify(prepared.evidence).replaceAll("<", "\\u003c")}</script><script id="status-fidelity-proof">${statusFidelityProofScript}</script></body></html>`;
        const proof = executeStatusFidelityProofWithStandInBoxes(html, width);
        expect(proof.documentElement.dataset.statusFidelityProof).toBe("pass");
        const path = `.git/status-fidelity-v1-${scene}-${theme}-${width}.html`;
        yield* fs.writeFileString(`../../${path}`, html);
        fixtures.push({
          path,
          scene,
          sha256: Array.from(
            yield* crypto.digest("SHA-256", new TextEncoder().encode(html)),
            (byte) => byte.toString(16).padStart(2, "0")
          ).join(""),
          theme,
          width,
        });
      }

      expect(fixtures).toHaveLength(5);
      fixtureSets.set(JSON.stringify([width, theme]), fixtures);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "collects only this run's twenty status fidelity artifacts into the new manifest",
  () =>
    Effect.gen(function* collectStatusFidelity() {
      const fs = yield* FileSystem.FileSystem;
      expect(fixtureSets.size).toBe(4);

      const fixtures = combinations.flatMap(
        (combination) => fixtureSets.get(JSON.stringify(combination)) ?? []
      );

      expect(fixtures).toHaveLength(20);
      yield* fs.writeFileString(
        "../../.git/status-fidelity-fixtures-v1.json",
        `${JSON.stringify({ base: "d4f14ee", fixtures, height: 900, historicalCreateApproval: "The previous create-types v2 files remain historical and untouched", proofAttribute: "data-status-fidelity-proof", proofValue: "pass", review: "layton-status-fidelity-1", source: "Actual saved fake-Google reads, normal root/editor/RPC PATCH receipts, plus an accepted Focus insert", workerQualification: "Exact embedded scripts execute under explicit DOM stand-in boxes; desk Chromium qualifies actual panel bounds" }, null, 2)}\n`
      );
    }).pipe(Effect.provide(NodeServices.layer))
);
