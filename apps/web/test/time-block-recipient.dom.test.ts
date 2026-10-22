import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Option, Predicate, Stream } from "effect";
import { vi } from "vitest";

import { clipboardAnchorAt } from "../src/client/clipboard/anchor.js";
import { clipboardGridHost } from "../src/client/clipboard/host.js";
import { ScrollToNow } from "../src/client/commands.js";
import { pointerPoint } from "../src/client/editing/gesture-input.js";
import {
  acceptsGesture,
  modelGestureHostKey,
} from "../src/client/editing/gesture-targets.js";
import { PrepareTimeGrid } from "../src/client/grid-mount.js";
import { timeGridGeometry } from "../src/client/time-blocks/grid.js";
import { gridGeometry } from "../src/layout/geometry.js";
import { timeBlockDay, timeBlockModel } from "./time-block-fixture.js";
import { nativeTimeBlockScene } from "./time-block-native.js";

for (const scene of ["day", "week", "14-day"] as const) {
  it.effect(
    `native ${scene} drag crosses the strip in minutes, not compressed pixels, and preserves the real duration`,
    () =>
      Effect.gen(function* dragAcrossStrip() {
        const result = yield* nativeTimeBlockScene(scene, 900, "light", true);
        expect(result.phase).toBe("dragging");
        expect(result.preview.range).toMatchObject({
          endDate: "2026-10-21",
          endTime: "16:30",
          startDate: "2026-10-21",
          startTime: "13:30",
        });
        expect(result.completed?.range).toEqual(result.preview.range);
        expect(result.steps.map((step) => step.minute)).toEqual([
          645, 825, 825,
        ]);
        expect((result.steps[1]?.y ?? 0) - (result.steps[0]?.y ?? 0)).toBe(72);
      }).pipe(Effect.scoped)
  );
}

it.effect(
  "pointer and clipboard inverses share the strip, and changed geometry invalidates old gesture and clipboard hosts",
  () =>
    Effect.sync(() => {
      const model = timeBlockModel("day");
      const { grid, scale } = timeGridGeometry(model);
      const root = document.createElement("div");
      root.innerHTML = `<div id="gesture-host"><div class="day-column" data-day="${timeBlockDay}"></div><div class="all-day"><div class="all-day-cell" data-day="${timeBlockDay}"></div></div></div>`;
      const column = root.querySelector<HTMLElement>(".day-column");
      const allDay = root.querySelector<HTMLElement>(".all-day-cell");

      if (column === null || allDay === null) {
        throw new Error("Missing inverse fixture cells");
      }

      root.getBoundingClientRect = () => new DOMRect(0, 0, 100, 1200);
      column.getBoundingClientRect = () => new DOMRect(0, 0, 100, grid.height);
      allDay.getBoundingClientRect = () => new DOMRect(0, 0, 100, 25);

      const point = new PointerEvent("pointermove", {
        clientX: 50,
        clientY: 540,
        isPrimary: true,
        pointerId: 1,
      });

      expect(
        Option.getOrThrow(pointerPoint(root, point, scale, false, grid)).minute
      ).toBe(720);
      expect(
        Option.getOrThrow(pointerPoint(root, point, scale, true, grid)).minute
      ).toBe(0);

      const anchor = Option.getOrThrow(
        clipboardAnchorAt(
          {
            grid,
            key: "compressed",
            mode: "time",
            root,
            scale,
            zone: "America/Los_Angeles",
          },
          { alt: false, key: "compressed", shift: false, x: 50, y: 540 },
          column
        )
      );

      expect(anchor._tag).toBe("Timed");

      if (Predicate.isTagged(anchor, "Timed")) {
        expect(anchor.instant).toBe(
          DateTime.toEpochMillis(
            DateTime.makeUnsafe("2026-10-21T12:00:00-07:00")
          )
        );
      }

      const oldKey = Option.getOrThrow(modelGestureHostKey(model));

      const off = {
        ...model,
        settings: {
          ...model.settings,
          timeBlocks: { ...model.settings.timeBlocks, enabled: false },
        },
      };

      expect(acceptsGesture(off, Option.getOrThrow(model.person), oldKey)).toBe(
        false
      );
      const originalHost = clipboardGridHost(model, root.ownerDocument);
      document.body.append(root);

      try {
        const enabled = clipboardGridHost(model, document);
        const disabled = clipboardGridHost(off, document);
        expect(enabled?.key).not.toBe(disabled?.key);
        expect(enabled?.grid?.hidden).toEqual(grid.hidden);
        expect(disabled?.grid?.hidden).toEqual([]);
        expect(originalHost).toBeUndefined();
      } finally {
        root.remove();
      }
    })
);

it.effect(
  "initial and Today scroll commands project the same hidden minute instead of scrolling to the old linear height",
  () =>
    Effect.gen(function* compressedScroll() {
      class Observer {
        static active = 0;
        active = false;
        observe() {
          this.active = true;
          Observer.active += 1;
        }
        disconnect() {
          if (this.active) {
            this.active = false;
            Observer.active -= 1;
          }
        }
      }

      vi.stubGlobal("ResizeObserver", Observer);
      vi.stubGlobal(
        "requestAnimationFrame",
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- The native animation-frame callback drives Foldkit's post-commit scroll command.
        (callback: FrameRequestCallback) => {
          // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Invoke the native callback at this controlled animation-frame boundary.
          callback(0);

          return 1;
        }
      );
      const root = document.createElement("section");
      root.innerHTML =
        '<div id="time-viewport"><div class="day-headers"></div><div class="all-day-stack"></div><div class="day-columns"><div class="day-column today-column"></div></div></div>';
      document.body.append(root);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          root.remove();
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

      Object.defineProperty(viewport, "clientHeight", { value: 700 });
      Object.defineProperty(header, "offsetHeight", { value: 28 });
      Object.defineProperty(allDay, "offsetHeight", { value: 25 });
      const grid = gridGeometry(48, [{ endMinute: 780, startMinute: 660 }]);
      yield* PrepareTimeGrid({
        hidden: grid.hidden,
        initialMinute: 720,
        initialScale: 48,
      })
        .f(root, Stream.empty)
        .pipe(Stream.runHead);
      expect(viewport.scrollTop).toBeCloseTo(540 - 647 / 3);
      expect(Observer.active).toBe(0);
      viewport.scrollTop = 0;
      yield* ScrollToNow({ hidden: grid.hidden, minute: 720, scale: 48 })
        .effect;
      expect(viewport.scrollTop).toBeCloseTo(540 - 647 / 3);
    }).pipe(Effect.scoped)
);
