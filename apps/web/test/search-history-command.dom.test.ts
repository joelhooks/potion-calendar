import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";
import { vi } from "vitest";

import { update } from "../src/client/app.js";
import {
  CaptureSearchPage,
  RestoreSearchAnchor,
} from "../src/client/search/commands.js";
import { view } from "../src/features/app.js";
import {
  searchHistoryFixture,
  searchHistoryScenes,
} from "./search-history-fixture.js";

for (const scene of searchHistoryScenes.filter(
  (candidate) => candidate.width !== 390
)) {
  it.effect(
    `actual ${scene.scene} page commands measure the latest scrolled row, merge through update and restore that row after rendering`,
    () =>
      Effect.gen(function* actualSearchAnchorCommands() {
        const fixture = searchHistoryFixture(scene);

        const first = yield* renderToString(
          { init: () => ({ model: fixture.pending }), view },
          { isHydratable: false }
        );

        const root = document.createElement("div");
        root.innerHTML = first.html;
        document.body.append(root);

        const frames = vi
          .spyOn(globalThis, "requestAnimationFrame")
          .mockImplementation((onFrame) => {
            queueMicrotask(() => {
              onFrame(0);
            });

            return 1;
          });

        const geometry = vi
          .spyOn(HTMLElement.prototype, "getBoundingClientRect")
          .mockImplementation(function box(this: HTMLElement) {
            const viewport = this.closest<HTMLElement>("#search-results");

            if (this.id === "search-results") {
              return new DOMRect(0, 100, 900, 600);
            }

            const topHeight =
              (viewport?.querySelector("[data-search-history-controls]")
                ?.childElementCount ?? 0) * 30;

            if (this.matches("[data-search-event]") && viewport !== null) {
              const index = [
                ...viewport.querySelectorAll("[data-search-event]"),
              ].indexOf(this);

              return new DOMRect(
                0,
                100 + topHeight + index * 100 - viewport.scrollTop,
                900,
                60
              );
            }

            return new DOMRect();
          });

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            geometry.mockRestore();
            frames.mockRestore();
            root.remove();
          })
        );
        const viewport = root.querySelector<HTMLElement>("#search-results");
        expect(viewport).not.toBeNull();

        if (viewport === null) {
          throw new Error("Missing actual search viewport");
        }

        viewport.scrollTop = 440;
        viewport.scrollTop = 640;

        const measured = yield* CaptureSearchPage({ notice: fixture.notice })
          .effect;

        expect(
          measured.anchor.pipe(Option.map((anchor) => anchor.position))
        ).toEqual(Option.some(640));
        const merged = update(fixture.pending, measured);
        expect(merged.commands?.map((command) => command.name)).toEqual([
          "RestoreSearchAnchor",
        ]);

        const restore = RestoreSearchAnchor({
          anchor: measured.anchor,
          task: fixture.notice.page.task,
        });

        expect(merged.commands?.[0]?.args).toEqual(restore.args);

        const second = yield* renderToString(
          { init: () => ({ model: merged.model }), view },
          { isHydratable: false }
        );

        root.innerHTML = second.html;

        const afterViewport =
          root.querySelector<HTMLElement>("#search-results");

        if (afterViewport === null) {
          throw new Error("Page merge lost the search viewport");
        }

        afterViewport.scrollTop = 640;
        yield* restore.effect;
        expect(afterViewport.scrollTop).toBe(
          scene.scene === "horizon" ? 610 : 910
        );
        const anchor = Option.getOrThrow(measured.anchor);

        const row = [
          ...afterViewport.querySelectorAll<HTMLElement>("[data-search-event]"),
        ].find((element) => element.dataset.searchEvent === anchor.key);

        expect(row?.getBoundingClientRect().top).toBe(100 + anchor.offset);
      }).pipe(Effect.scoped)
  );
}
