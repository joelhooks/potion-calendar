import { statusEventLabel } from "@calendar/calendar/contracts";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";

import type { AppModel } from "../src/client/app.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import {
  currentConversion,
  EditorView,
} from "../src/client/editing/editor-model.js";
import {
  createTypeRuntimeFixture,
  nextTypeNotice,
  renderTypeRoot,
} from "./create-type-runtime-fixture.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";
import {
  conversionProofScript,
  executeConversionProofWithStandInBoxes,
} from "./type-conversion-proof.js";

const viewports = [
  [1440, "light"],
  [1440, "dark"],
  [900, "light"],
  [900, "dark"],
  [390, "light"],
  [390, "dark"],
] as const;

it.effect.each(viewports)(
  "exports paired before/converted plus restored controls at %s in %s from the actual editor actor",
  ([width, theme]) =>
    Effect.gen(function* conversionExports() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      const height = width === 390 ? 844 : 900;

      for (const [title, target] of [
        ["Focus", "focusTime"],
        ["OOO", "outOfOffice"],
      ] as const) {
        const f = yield* createTypeRuntimeFixture("event");
        yield* f.editText("title", title);
        const before = yield* Ref.get(f.state);

        const beforeView = yield* Schema.decodeUnknownEffect(
          EditorView.cases.Editing
        )(before.editing.view);

        yield* TestClock.adjust(250);
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        const converted = yield* Ref.get(f.state);
        const notice = currentConversion(converted.editing.view);
        expect(notice?.target).toBe(target);

        if (notice === undefined) {
          return;
        }

        yield* nextTypeNotice(
          f.queue,
          (row) => currentConversion(row.view)?.id === notice.id
        );
        yield* f.dispatch(
          EditorAction.cases.UndoConversion.make({ id: notice.id })
        );
        yield* nextTypeNotice(
          f.queue,
          (row) =>
            EditorView.guards.Editing(row.view) &&
            row.view.draft.eventType === beforeView.draft.eventType &&
            currentConversion(row.view) === undefined
        );
        const restored = yield* Ref.get(f.state);

        const restoredView = yield* Schema.decodeUnknownEffect(
          EditorView.cases.Editing
        )(restored.editing.view);

        expect(restoredView.draft).toEqual(beforeView.draft);
        const writes = (yield* Ref.get(f.api.fake.receipts)).length;
        expect(writes).toBe(0);

        for (const [stage, state] of [
          ["before", before],
          ["converted", converted],
          ["restored", restored],
        ] as const) {
          const model: AppModel = {
            ...state,
            calendar: {
              ...state.calendar,
              navigation: {
                ...state.calendar.navigation,
                mode: width <= 640 ? "day" : state.calendar.navigation.mode,
              },
              viewport: width <= 640 ? height - 145 : state.calendar.viewport,
              viewportWidth: width <= 640 ? width : width - 520,
            },
            phoneShell: { ...state.phoneShell, viewportWidth: width },
            settings: { ...state.settings, theme },
          };

          const rendered = yield* renderTypeRoot(model);

          const evidence = {
            beforeDraft: beforeView.draft,
            label: statusEventLabel(target),
            proofTier:
              "Actual root/editor actor and local Undo. Static HTML and explicit Node geometry stand-ins; no browser/native/provider proof.",
            restoredDraft: restoredView.draft,
            stage,
            target,
            title,
            writes,
          };

          const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="fixture-viewport" content="${width}x${height}"><title>Draft conversion ${target} ${stage} ${theme}</title><style>${css}</style></head><body>${rendered.html}<script id="conversion-evidence" type="application/json">${JSON.stringify(evidence).replaceAll("<", "\\u003c")}</script><script id="conversion-proof">${conversionProofScript}</script></body></html>`;
          let proof: string | undefined;
          expect(() => {
            proof = executeConversionProofWithStandInBoxes(html, width, height);
          }).not.toThrow();
          expect(proof).toBe("pass");

          if (stage === "converted") {
            for (const action of ["save", "cancel"] as const) {
              expect(() =>
                executeConversionProofWithStandInBoxes(
                  html,
                  width,
                  height,
                  action
                )
              ).toThrow(
                `Conversion toast overlaps footer ${action === "save" ? "Save" : "Cancel"}`
              );
            }
          }

          yield* publishFixtureArtifact(
            `../../.git/type-conversion-${target}-${stage}-${theme}-${width}-fixture.html`,
            html
          );
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
