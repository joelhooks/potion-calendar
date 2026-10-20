import { expect, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { vi } from "vitest";

import { ScrollToNow } from "../src/client/commands.js";
import { PrepareTimeGrid } from "../src/client/grid-mount.js";
import { initialScroll, timeColumns } from "../src/layout/geometry.js";
import { timeAreaHeight } from "../src/layout/grid-geometry.js";
import { zoneColumns } from "../src/layout/time-zones-grid.js";

it.effect(
  "four gutters at 900 keep the no-secondary day width and account for every gutter in the scroll content",
  () =>
    Effect.sync(() => {
      const available = 900 - 185 - 260;
      const plain = timeColumns(available, 7);
      const columns = zoneColumns(available, 7, 4);
      expect(columns.day).toBeGreaterThanOrEqual(plain.day);
      expect(columns.total).toBe(4 * 46 + 7 * columns.day);
      expect(columns.total).toBeGreaterThan(available);
    })
);

it.effect.each([1, 4])(
  "initial scroll and Today keep the current hour visible with %s zone columns and reveal horizontally scrolled Today",
  (zoneCount) =>
    Effect.gen(function* pinnedGridScroll() {
      let observed = 0;
      let disconnected = 0;

      class Observer {
        active = false;
        observe() {
          this.active = true;
          observed += 1;
        }
        disconnect() {
          if (this.active) {
            disconnected += 1;
          }

          this.active = false;
        }
      }

      const root = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const element = document.createElement("section");
          element.innerHTML =
            '<div id="time-viewport"><div class="day-headers"></div><div class="all-day-stack"></div><div class="day-columns"><div class="day-column today-column"></div></div></div>';
          document.body.append(element);
          vi.stubGlobal("ResizeObserver", Observer);
          vi.stubGlobal(
            "requestAnimationFrame",
            (onFrame: FrameRequestCallback) => {
              onFrame(0);

              return 1;
            }
          );

          return element;
        }),
        (element) =>
          Effect.sync(() => {
            element.remove();
            vi.unstubAllGlobals();
          })
      );

      const viewport = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>("#time-viewport")
      );

      const header = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>(".day-headers")
      );

      const allDay = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>(".all-day-stack")
      );

      const columns = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>(".day-columns")
      );

      const today = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>(".today-column")
      );

      Object.defineProperty(viewport, "clientHeight", { value: 700 });
      Object.defineProperty(viewport, "clientWidth", { value: 455 });
      Object.defineProperty(header, "offsetHeight", { value: 28 });
      Object.defineProperty(allDay, "offsetHeight", { value: 25 });
      const gutter = zoneCount * 46;
      viewport.getBoundingClientRect = () => new DOMRect(185, 0, 455, 700);
      columns.getBoundingClientRect = () =>
        new DOMRect(
          185 + gutter - viewport.scrollLeft,
          53 - viewport.scrollTop,
          7 * 59,
          1152
        );
      today.getBoundingClientRect = () =>
        new DOMRect(
          185 + gutter + 5 * 59 - viewport.scrollLeft,
          53 - viewport.scrollTop,
          59,
          1152
        );
      yield* PrepareTimeGrid({ initialMinute: 600, initialScale: 48 })
        .f(root, Stream.empty)
        .pipe(Stream.runHead);
      expect(observed).toBe(1);
      expect(disconnected).toBe(1);
      expect(timeAreaHeight(viewport)).toBe(647);
      const previousBodyScroll = initialScroll(600, 48, 647);
      expect(viewport.scrollTop).toBe(previousBodyScroll);
      expect(53 + 480 - viewport.scrollTop).toBeCloseTo(53 + 647 / 3);
      viewport.scrollLeft = 400;
      yield* ScrollToNow({ minute: 600, scale: 48 }).effect;
      expect(viewport.scrollTop).toBe(previousBodyScroll);
      expect(today.getBoundingClientRect().left).toBeGreaterThanOrEqual(
        185 + gutter
      );
      expect(today.getBoundingClientRect().right).toBeLessThanOrEqual(
        185 + 455
      );
    })
);
