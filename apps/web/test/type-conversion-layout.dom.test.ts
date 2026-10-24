import { statusEventLabel } from "@calendar/calendar/contracts";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";

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
import {
  conversionProofScript,
  executeConversionProofWithStandInBoxes,
} from "./type-conversion-proof.js";

it.effect.each([
  [1440, "light"],
  [1440, "dark"],
  [900, "light"],
  [900, "dark"],
  [390, "light"],
  [390, "dark"],
] as const)(
  "keeps the real root notice in footer flow and rejects eight-pixel action overlaps at %s in %s",
  ([width, theme]) =>
    Effect.gen(function* conversionFooterGeometry() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      const height = width === 390 ? 844 : 900;
      const f = yield* createTypeRuntimeFixture("event");
      yield* f.editText("title", "Focus");
      const before = yield* Ref.get(f.state);

      const beforeView = yield* Schema.decodeUnknownEffect(
        EditorView.cases.Editing
      )(before.editing.view);

      yield* TestClock.adjust(250);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      const converted = yield* Ref.get(f.state);
      const notice = currentConversion(converted.editing.view);
      expect(notice?.target).toBe("focusTime");

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

      const restored = yield* nextTypeNotice(
        f.queue,
        (row) =>
          EditorView.guards.Editing(row.view) &&
          currentConversion(row.view) === undefined
      );

      const restoredView = yield* Schema.decodeUnknownEffect(
        EditorView.cases.Editing
      )(restored.view);

      expect(restoredView.draft).toEqual(beforeView.draft);
      const writes = (yield* Ref.get(f.api.fake.receipts)).length;
      expect(writes).toBe(0);

      const rendered = yield* renderTypeRoot({
        ...converted,
        calendar: {
          ...converted.calendar,
          navigation: {
            ...converted.calendar.navigation,
            mode: width <= 640 ? "day" : converted.calendar.navigation.mode,
          },
          viewport: width <= 640 ? height - 145 : converted.calendar.viewport,
          viewportWidth: width <= 640 ? width : width - 520,
        },
        phoneShell: { ...converted.phoneShell, viewportWidth: width },
        settings: { ...converted.settings, theme },
      });

      const evidence = {
        beforeDraft: beforeView.draft,
        label: statusEventLabel(notice.target),
        restoredDraft: restoredView.draft,
        stage: "converted",
        target: notice.target,
        title: "Focus",
        writes,
      };

      const html = `<!doctype html><html><head><style>${css}</style></head><body>${rendered.html}<script id="conversion-evidence" type="application/json">${JSON.stringify(evidence).replaceAll("<", "\\u003c")}</script><script id="conversion-proof">${conversionProofScript}</script></body></html>`;
      let proof: string | undefined;
      expect(() => {
        proof = executeConversionProofWithStandInBoxes(html, width, height);
      }).not.toThrow();
      expect(proof).toBe("pass");

      for (const action of ["save", "cancel"] as const) {
        expect(() =>
          executeConversionProofWithStandInBoxes(html, width, height, action)
        ).toThrow(
          `Conversion toast overlaps footer ${action === "save" ? "Save" : "Cancel"}`
        );
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
