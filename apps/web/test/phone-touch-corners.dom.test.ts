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
  function* rectangularCorners(input: typeof Frame.Type) {
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
      clientLeft: { value: 1 },
      clientTop: { value: 2 },
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
  "targets stay inside their own column rather than borrowing the adjacent day",
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
      expect(181 + chip.clientLeft + x + 44).toBeCloseTo(
        column.getBoundingClientRect().right
      );
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
