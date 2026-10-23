import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { placeTouchCorners } from "../src/client/editing/touch-surfaces.js";

const Frame = Schema.Struct({
  column: Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: 1 })),
  columns: Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: 1 })),
  height: Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: 100 })),
  itemHeight: Schema.Int.check(Schema.isBetween({ maximum: 200, minimum: 12 })),
  itemLeft: Schema.Int.check(Schema.isBetween({ maximum: 700, minimum: -100 })),
  itemTop: Schema.Int.check(Schema.isBetween({ maximum: 1200, minimum: -100 })),
  itemWidth: Schema.Int.check(Schema.isBetween({ maximum: 200, minimum: 12 })),
  width: Schema.Int.check(Schema.isBetween({ maximum: 640, minimum: 200 })),
});

const rectangularCorners = Effect.fn("phoneTouch.rectangularCorners")(
  function* rectangularCorners(
    input: typeof Frame.Type,
    border?: { readonly left: number; readonly top: number }
  ) {
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const element = document.createElement("section");
        element.id = "gesture-host";
        element.style.display = "contents";
        element.innerHTML =
          '<div id="time-viewport"><div class="day-columns"><div class="day-column"><button class="event-chip selected"><span class="touch-resize-target" data-touch-resize-edge="start"></span><span class="touch-resize-target" data-touch-resize-edge="end"></span></button></div></div></div>';
        document.body.append(element);

        return element;
      }),
      (element) =>
        Effect.sync(() => {
          element.remove();
        })
    );

    const viewport = yield* Effect.fromNullishOr(
      root.querySelector<HTMLElement>("#time-viewport")
    );

    const grid = yield* Effect.fromNullishOr(
      root.querySelector<HTMLElement>(".day-columns")
    );

    const column = yield* Effect.fromNullishOr(
      root.querySelector<HTMLElement>(".day-column")
    );

    const chip = yield* Effect.fromNullishOr(
      root.querySelector<HTMLElement>(".event-chip")
    );

    const dayWidth = (input.width - 46) / input.columns;
    const dayLeft = 46 + ((input.column - 1) % input.columns) * dayWidth;
    root.getBoundingClientRect = () => new DOMRect();
    column.getBoundingClientRect = () =>
      new DOMRect(dayLeft, 0, dayWidth, 2000);
    viewport.getBoundingClientRect = () =>
      new DOMRect(0, 100, input.width, input.height);
    grid.getBoundingClientRect = () =>
      new DOMRect(46, 0, input.width - 46, 2000);
    chip.getBoundingClientRect = () =>
      new DOMRect(
        input.itemLeft,
        input.itemTop,
        input.itemWidth,
        input.itemHeight
      );
    Object.defineProperties(viewport, {
      clientHeight: { value: input.height },
      clientWidth: { value: input.width },
    });
    Object.defineProperties(chip, {
      clientLeft: { value: border?.left ?? 1 },
      clientTop: { value: border?.top ?? 2 },
    });
    placeTouchCorners(root);

    return { chip, column, root };
  }
);

const coordinate = Effect.fn("phoneTouch.cornerCoordinate")(
  function* coordinate(target: HTMLElement, axis: "left" | "top") {
    const raw = target.style.getPropertyValue(`--touch-corner-${axis}`);
    expect(raw).toMatch(/^-?\d+(?:\.\d+)?px$/u);

    return yield* Schema.decodeEffect(Schema.Finite)(Number(raw.slice(0, -2)));
  }
);

const fractionalClippedCorners = Effect.fn("phoneTouch.fractionalClip")(
  function* fractionalClippedCorners(
    axis: "left" | "top",
    minimum: number,
    maximum: number
  ) {
    const scene = yield* rectangularCorners(
      {
        column: 1,
        columns: 1,
        height: 200,
        itemHeight: 12,
        itemLeft: 100,
        itemTop: 100,
        itemWidth: 12,
        width: 200,
      },
      { left: 1, top: 1 }
    );

    scene.column.getBoundingClientRect = () =>
      axis === "left"
        ? new DOMRect(minimum, 100, maximum - minimum, 100)
        : new DOMRect(100, minimum, 100, maximum - minimum);

    placeTouchCorners(scene.root);

    return scene;
  }
);

it.effect.each(["left", "top"] as const)(
  "a fractional clip without an integer offset keeps its contained target on a two-decimal grid: %s",
  (axis) =>
    Effect.gen(function* fractionalFallback() {
      const { root } = yield* fractionalClippedCorners(axis, 100.25, 144.5);
      const written = [];

      for (const target of root.querySelectorAll<HTMLElement>(
        ".touch-resize-target"
      )) {
        expect(Object.hasOwn(target.dataset, "touchCornerHidden")).toBe(false);
        const offset = yield* coordinate(target, axis);
        written.push(target.style.getPropertyValue(`--touch-corner-${axis}`));
        expect(101 + offset).toBeGreaterThanOrEqual(100.25);
        expect(101 + offset + 44).toBeLessThanOrEqual(144.5);
      }

      expect(written).toEqual(["-0.75px", "-0.50px"]);
    }).pipe(Effect.scoped)
);

it.effect.each(["left", "top"] as const)(
  "a neighboring feasible fractional clip retains whole-pixel offsets: %s",
  (axis) =>
    Effect.gen(function* wholePixelNeighbor() {
      const { root } = yield* fractionalClippedCorners(axis, 100.25, 145);

      for (const target of root.querySelectorAll<HTMLElement>(
        ".touch-resize-target"
      )) {
        expect(Object.hasOwn(target.dataset, "touchCornerHidden")).toBe(false);
        const offset = yield* coordinate(target, axis);
        expect(target.style.getPropertyValue(`--touch-corner-${axis}`)).toBe(
          "0px"
        );
        expect(Object.is(offset, -0)).toBe(false);
        expect(101 + offset).toBeGreaterThanOrEqual(100.25);
        expect(101 + offset + 44).toBeLessThanOrEqual(145);
      }
    }).pipe(Effect.scoped)
);

it.effect.each(["left", "top"] as const)(
  "a clip with under one hundredth pixel of slack hides only when neither grid has an offset: %s",
  (axis) =>
    Effect.gen(function* unplaceableFractionalClip() {
      const { root } = yield* fractionalClippedCorners(axis, 100.251, 144.259);

      for (const target of root.querySelectorAll<HTMLElement>(
        ".touch-resize-target"
      )) {
        expect(Object.hasOwn(target.dataset, "touchCornerHidden")).toBe(true);
      }
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "derived44px corners stay inside each visible day column under an unboxed root without claiming browser geometry",
  { frame: Frame },
  ({ frame }) =>
    Effect.gen(function* generatedCornerBounds() {
      const { chip, column, root } = yield* rectangularCorners(frame);
      const day = column.getBoundingClientRect();
      expect(root.style.display).toBe("contents");
      expect(root.getBoundingClientRect().width).toBe(0);

      const visible =
        frame.itemLeft + frame.itemWidth > day.left &&
        frame.itemLeft < day.right &&
        frame.itemTop + frame.itemHeight > 100 &&
        frame.itemTop < frame.height + 100;

      for (const target of root.querySelectorAll<HTMLElement>(
        ".touch-resize-target"
      )) {
        const x = yield* coordinate(target, "left");
        const y = yield* coordinate(target, "top");
        expect(Number.isInteger(x)).toBe(true);
        expect(Number.isInteger(y)).toBe(true);
        expect(Object.is(x, -0)).toBe(false);
        expect(Object.is(y, -0)).toBe(false);
        const left = frame.itemLeft + chip.clientLeft + x;
        const top = frame.itemTop + chip.clientTop + y;
        expect(left).toBeGreaterThanOrEqual(
          day.left - Number.EPSILON * frame.width
        );
        expect(left + 44).toBeLessThanOrEqual(
          day.right + Number.EPSILON * frame.width
        );
        expect(top).toBeGreaterThanOrEqual(100);
        expect(top + 44).toBeLessThanOrEqual(frame.height + 100);
        expect(Object.hasOwn(target.dataset, "touchCornerHidden")).toBe(
          !visible
        );
      }
    }).pipe(Effect.scoped)
);

it.effect(
  "the exact prod-69 shrunk frame serializes whole-pixel corners without scientific notation",
  () =>
    Effect.gen(function* shrunkCornerFrame() {
      const { root } = yield* rectangularCorners({
        column: 3,
        columns: 3,
        height: 100,
        itemHeight: 12,
        itemLeft: 192,
        itemTop: 0,
        itemWidth: 12,
        width: 237,
      });

      const coordinates = [];

      for (const target of root.querySelectorAll<HTMLElement>(
        ".touch-resize-target"
      )) {
        const x = yield* coordinate(target, "left");
        const y = yield* coordinate(target, "top");
        coordinates.push({ edge: target.dataset.touchResizeEdge, x, y });
      }

      expect(coordinates).toEqual([
        { edge: "start", x: -19, y: 98 },
        { edge: "end", x: -1, y: 98 },
      ]);
    }).pipe(Effect.scoped)
);

it.effect(
  "fractional rendered event dimensions round interior end-corner offsets",
  () =>
    Effect.gen(function* fractionalRenderedCorner() {
      const { chip, root } = yield* rectangularCorners({
        column: 1,
        columns: 1,
        height: 600,
        itemHeight: 44,
        itemLeft: 49,
        itemTop: 140,
        itemWidth: 83,
        width: 390,
      });

      chip.getBoundingClientRect = () => new DOMRect(49, 140, 83.25, 44.25);
      placeTouchCorners(root);

      const end = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>('[data-touch-resize-edge="end"]')
      );

      expect(yield* coordinate(end, "left")).toBe(75);
      expect(yield* coordinate(end, "top")).toBe(35);
    }).pipe(Effect.scoped)
);

it.effect(
  "an unboxed host leaves the normal start target inside the day instead of the gutter",
  () =>
    Effect.gen(function* normalColumnFrame() {
      const { chip, root } = yield* rectangularCorners({
        column: 1,
        columns: 1,
        height: 600,
        itemHeight: 50,
        itemLeft: 49,
        itemTop: 471,
        itemWidth: 338,
        width: 390,
      });

      const start = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>('[data-touch-resize-edge="start"]')
      );

      const x = yield* coordinate(start, "left");
      expect(49 + chip.clientLeft + x).toBe(46);
    }).pipe(Effect.scoped)
);

it.effect(
  "whole-pixel targets align inward within one pixel of their own fractional column edge",
  () =>
    Effect.gen(function* separateColumnFrame() {
      const { chip, column, root } = yield* rectangularCorners({
        column: 2,
        columns: 3,
        height: 600,
        itemHeight: 16,
        itemLeft: 181,
        itemTop: 140,
        itemWidth: 83,
        width: 390,
      });

      const end = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>('[data-touch-resize-edge="end"]')
      );

      const x = yield* coordinate(end, "left");
      const right = 181 + chip.clientLeft + x + 44;
      const columnRight = column.getBoundingClientRect().right;
      expect(right).toBeLessThanOrEqual(columnRight);
      expect(columnRight - right).toBeLessThan(1);
    }).pipe(Effect.scoped)
);

it.effect(
  "the native-reported short overlap frame keeps the full end target within390px",
  () =>
    Effect.gen(function* shortOverlapFrame() {
      const { chip, root } = yield* rectangularCorners({
        column: 1,
        columns: 1,
        height: 600,
        itemHeight: 44,
        itemLeft: 305,
        itemTop: 140,
        itemWidth: 83,
        width: 390,
      });

      const end = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>('[data-touch-resize-edge="end"]')
      );

      const x = yield* coordinate(end, "left");
      expect(305 + chip.clientLeft + x).toBe(346);
      expect(305 + chip.clientLeft + x + 44).toBe(390);
    }).pipe(Effect.scoped)
);
