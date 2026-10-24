import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  measureSearchAnchor,
  restoreSearchAnchor,
} from "../src/client/search/scroll-anchor.js";

it.effect.prop(
  "keyed-row anchoring preserves the latest visible offset with or without native scroll anchoring and is idempotent",
  {
    inserted: Schema.Int.check(
      Schema.isBetween({ maximum: 1200, minimum: 20 })
    ),
    nativeAnchor: Schema.Boolean,
    offset: Schema.Int.check(Schema.isBetween({ maximum: 500, minimum: -30 })),
    position: Schema.Int.check(
      Schema.isBetween({ maximum: 1200, minimum: 50 })
    ),
  },
  ({ inserted, nativeAnchor, offset, position }) =>
    Effect.gen(function* latestVisibleAnchor() {
      const viewport = document.createElement("div");
      viewport.id = "search-results";
      const row = document.createElement("button");
      row.dataset.searchEvent = "existing-row";
      viewport.append(row);
      document.body.append(viewport);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          viewport.remove();
        })
      );
      let top = position;
      let added = 0;
      Object.defineProperty(viewport, "scrollTop", {
        configurable: true,
        get: () => top,
        set: (value: number) => {
          top = value;
        },
      });
      viewport.getBoundingClientRect = () => new DOMRect(0, 100, 600, 600);
      row.getBoundingClientRect = () =>
        new DOMRect(0, 100 + offset + added - (top - position), 600, 60);
      const anchor = measureSearchAnchor(document);
      expect(anchor).toEqual({ key: "existing-row", offset, position });
      added = inserted;

      if (nativeAnchor) {
        top += inserted;
      }

      restoreSearchAnchor(document, anchor);
      expect(top).toBe(position + inserted);
      expect(row.getBoundingClientRect().top - 100).toBe(offset);
      restoreSearchAnchor(document, anchor);
      expect(top).toBe(position + inserted);
      expect(viewport.dataset.searchRestoredPosition).toBe(String(top));
    }).pipe(Effect.scoped)
);

it.effect(
  "an empty result list can anchor Today rather than shift its no-upcoming section when history arrives",
  () =>
    Effect.gen(function* todayAnchor() {
      const viewport = document.createElement("div");
      viewport.id = "search-results";
      const today = document.createElement("section");
      today.id = "search-today";
      viewport.append(today);
      document.body.append(viewport);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          viewport.remove();
        })
      );
      let added = 0;
      viewport.getBoundingClientRect = () => new DOMRect(0, 100, 600, 600);
      today.getBoundingClientRect = () =>
        new DOMRect(0, 120 + added - viewport.scrollTop, 600, 100);
      const anchor = measureSearchAnchor(document);
      expect(anchor?.key).toBe("search-today");
      added = 200;
      restoreSearchAnchor(document, anchor);
      expect(viewport.scrollTop).toBe(200);
      expect(today.getBoundingClientRect().top).toBe(120);
    }).pipe(Effect.scoped)
);

it.effect(
  "an empty page with no anchor still marks the committed position so layout scroll cannot spend a second trigger budget",
  () =>
    Effect.gen(function* emptyPageScrollMarker() {
      const viewport = document.createElement("div");
      viewport.id = "search-results";
      document.body.append(viewport);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          viewport.remove();
        })
      );
      viewport.scrollTop = 12;
      restoreSearchAnchor(document);
      expect(viewport.scrollTop).toBe(12);
      expect(viewport.dataset.searchRestoredPosition).toBe("12");
    }).pipe(Effect.scoped)
);
