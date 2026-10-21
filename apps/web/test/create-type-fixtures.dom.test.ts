import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Crypto, Effect, FileSystem, Option, Ref, Schema } from "effect";

import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import {
  createTypeProofScript,
  executeCreateTypeProofWithStandInBoxes,
} from "./create-type-proof.js";
import {
  createTypeRuntimeFixture,
  nextTypeNotice,
  renderTypeRoot,
  typeFixtureId,
  typeScenes,
  typeTitle,
} from "./create-type-runtime-fixture.js";

interface ExportedFixture {
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

const fixtureSets = new Map<string, readonly ExportedFixture[]>();

it.effect.each(combinations)(
  "exports five real-root create scenes at %s in %s with actual fake-Google receipts and exact embedded proofs",
  ([width, theme]) =>
    Effect.gen(function* createTypeArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const crypto = yield* Crypto.Crypto;
      const css = yield* fs.readFileString("src/client/style.css");

      const fixtures: ExportedFixture[] = [];

      for (const scene of typeScenes) {
        const f = yield* createTypeRuntimeFixture(scene);
        const before = yield* Ref.get(f.state);

        const beforeView = yield* Schema.decodeUnknownEffect(
          EditorView.cases.Editing
        )(before.editing.view);

        expect(f.calendar.accountId).toBe("account");
        expect(f.calendar.calendarId).toBe("calendar");
        expect(f.calendar.accessRole).toBe("owner");
        expect(f.calendar.primary).toBe(scene !== "ineligible");

        if (scene !== "ineligible") {
          yield* f.dispatch(EditorAction.cases.Save.make({}));
          yield* nextTypeNotice(f.queue, (notice) =>
            scene === "refused"
              ? EditorView.guards.Failure(notice.view)
              : Option.isSome(notice.mutation)
          );
        }

        const after = yield* Ref.get(f.state);
        const receipts = yield* Ref.get(f.api.fake.receipts);

        const createdCount = receipts.filter(
          (receipt) =>
            receipt.request.method === "POST" &&
            receipt.response.status >= 200 &&
            receipt.response.status < 300
        ).length;

        const renderedModel = scene === "refused" ? after : before;

        const afterDraft =
          scene === "refused"
            ? (yield* Schema.decodeUnknownEffect(EditorView.cases.Failure)(
                after.editing.view
              )).draft
            : undefined;

        const model = {
          ...renderedModel,
          calendar: {
            ...renderedModel.calendar,
            viewportWidth: width - (width <= 1000 ? 445 : 520),
          },
          settings: { ...renderedModel.settings, theme },
        };

        const rendered = yield* renderTypeRoot(model);

        const evidence = {
          afterDraft,
          beforeDraft: beforeView.draft,
          calendar: f.calendar,
          createId: typeFixtureId,
          createdCount,
          qualification:
            "Actual root/runtime/RPC/fake-Google request-response receipts. No live provider operation.",
          receipts,
          renderedStage: scene === "refused" ? "after-refusal" : "before-save",
          scene,
          title: typeTitle[scene],
        };

        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>Create ${scene} ${theme}</title><style>${css}</style></head><body>${rendered.html}<script id="create-type-evidence" type="application/json">${JSON.stringify(evidence).replaceAll("<", "\\u003c")}</script><script id="create-type-proof">${createTypeProofScript}</script></body></html>`;
        const proof = executeCreateTypeProofWithStandInBoxes(html, width);
        expect(proof.documentElement.dataset.createTypeProof).toBe("pass");
        const path = `.git/create-types-v2-${scene}-${theme}-${width}.html`;
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
  "collects this run's twenty exported create scenes into one ordered manifest",
  () =>
    Effect.gen(function* collectTypeFixtures() {
      const fs = yield* FileSystem.FileSystem;
      expect(fixtureSets.size).toBe(4);

      const fixtures = combinations.flatMap(
        (combination) => fixtureSets.get(JSON.stringify(combination)) ?? []
      );

      expect(fixtures).toHaveLength(20);
      yield* fs.writeFileString(
        "../../.git/create-types-fixtures-v2.json",
        `${JSON.stringify({ base: "9bcacc4", fixtures, height: 900, proofAttribute: "data-create-type-proof", proofValue: "pass", review: "layton-create-types-2", source: "Real root, existing actors, RPC, CalendarService and fake-Google insert request-response receipts", workerQualification: "Exact embedded scripts executed under explicit DOM stand-in geometry; real geometry remains desk-qualified." }, null, 2)}\n`
      );
    }).pipe(Effect.provide(NodeServices.layer))
);
