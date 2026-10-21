import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { primarySelection } from "../src/layout/selection-set.js";
import { undoFixture } from "./undo-fixture.js";

const selectedBlocks = (document: Document | undefined, key: string) =>
  [...(document?.querySelectorAll<HTMLElement>(".event-chip") ?? [])].filter(
    (element) => element.dataset.eventKey === key
  );

it.effect(
  "pending delete removes the selected block and closes detail; Undo restores the block, detail and recurring selection",
  () =>
    Effect.gen(function* deleteUndoDom() {
      const state = undoFixture();
      const key = Option.getOrThrow(state.intent.selection);
      const documents: Document[] = [];

      for (const model of [state.base, state.pending, state.restored]) {
        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        documents.push(
          new DOMParser().parseFromString(rendered.html, "text/html")
        );
      }

      const [before, pending, restored] = documents;

      expect(selectedBlocks(before, key)).toHaveLength(1);
      expect(before?.querySelector(".detail-panel")?.textContent).toContain(
        state.intent.title
      );
      expect(selectedBlocks(pending, key)).toHaveLength(0);
      expect(pending?.querySelector(".detail-panel")).toBeNull();
      expect(
        Option.isNone(primarySelection(state.pending.calendar.selected))
      ).toBe(true);
      expect(pending?.querySelector(".undo-toast")?.textContent).toContain(
        state.intent.title
      );
      expect(selectedBlocks(restored, key)).toHaveLength(1);
      expect(restored?.querySelector(".detail-panel")?.textContent).toContain(
        state.intent.title
      );
      expect(restored?.querySelector(".undo-toast")).toBeNull();
      expect(state.restored.calendar.selected).toEqual(
        state.base.calendar.selected
      );
      expect(state.restored.calendar.navigation).toEqual(
        state.base.calendar.navigation
      );
      expect(state.restored.calendar.reads).toEqual(state.base.calendar.reads);
      expect(state.intent.event.recurringEventId).toBe("fixture-review-series");
      expect(state.intent.event.originalStartTime).toEqual(
        state.intent.event.start
      );
    })
);
