import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import {
  applyMonthRebase,
  retainMonthFocus,
} from "../src/client/month/frame.js";
import { MonthRebaseRequest } from "../src/client/month/scroll-machine.js";
import { MonthPosition } from "../src/layout/month-window.js";

const bounded = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ maximum, minimum }));

const viewportFixture = Effect.acquireRelease(
  Effect.sync(() => {
    const viewport = document.createElement("div");
    viewport.dataset.monthFirstWeek = "20000";
    viewport.dataset.monthRebaseId = "1";
    viewport.innerHTML =
      '<div class="month-week" data-week-start="20000"><button class="month-date">Date</button></div><button class="outside-week">Outside week</button>';
    document.body.append(viewport);

    return viewport;
  }),
  (viewport) =>
    Effect.sync(() => {
      viewport.remove();
    })
);

it.effect.prop(
  "native rebase compensation uses the live offset rather than the stale requested offset and preserves the pointer date",
  {
    delta: bounded(-20, 20),
    height: bounded(20, 200),
    pointer: bounded(0, 599),
    rows: Schema.Union([bounded(-6, -4), bounded(3, 6)]),
  },
  ({ height, delta, pointer, rows }) =>
    Effect.gen(function* liveRebase() {
      const viewport = yield* viewportFixture;

      const liveTop = Math.max(
        0,
        Math.min(12 * height, (6 + rows) * height + delta)
      );

      const pointerY = pointer % (6 * height);
      viewport.scrollTop = liveTop;

      const request = MonthRebaseRequest.make({
        id: 1,
        pinnedWeek: Option.none(),
        position: MonthPosition.make({
          firstWeek: 20_000,
          scrollTop: 6 * height,
        }),
        rows,
      });

      const result = Option.getOrThrow(
        applyMonthRebase(viewport, request, height)
      );

      expect(result.scrollTop).toBe(liveTop - rows * height);

      const beforeDay =
        20_000 - rows * 7 + Math.floor((liveTop + pointerY) / height) * 7;

      const afterDay =
        result.firstWeek +
        Math.floor((result.scrollTop + pointerY) / height) * 7;

      expect(afterDay).toBe(beforeDay);
    })
);

it.effect(
  "a stale or detached frame cannot change native scroll or acknowledge another rendered window",
  () =>
    Effect.gen(function* rejectStaleFrame() {
      const viewport = yield* viewportFixture;
      viewport.scrollTop = 700;

      const request = MonthRebaseRequest.make({
        id: 1,
        pinnedWeek: Option.none(),
        position: MonthPosition.make({ firstWeek: 20_007, scrollTop: 400 }),
        rows: 3,
      });

      expect(Option.isNone(applyMonthRebase(viewport, request, 100))).toBe(
        true
      );
      expect(viewport.scrollTop).toBe(700);
      viewport.dataset.monthFirstWeek = "20007";
      viewport.dataset.monthRebaseId = "2";
      expect(Option.isNone(applyMonthRebase(viewport, request, 100))).toBe(
        true
      );
      expect(viewport.scrollTop).toBe(700);
      viewport.dataset.monthRebaseId = "1";
      viewport.remove();
      expect(Option.isNone(applyMonthRebase(viewport, request, 100))).toBe(
        true
      );
      expect(viewport.scrollTop).toBe(700);
    })
);

it.effect(
  "focus retention restores the same live node after a keyed row move without scrolling",
  () =>
    Effect.gen(function* retainedFocus() {
      const viewport = yield* viewportFixture;

      const button = yield* Effect.fromNullishOr(
        viewport.querySelector<HTMLButtonElement>(".month-date")
      );

      button.focus();

      const lease = yield* Effect.acquireRelease(
        Effect.sync(() => Option.getOrThrow(retainMonthFocus(viewport))),
        (resource) => Effect.sync(resource.release)
      );

      expect(lease.week).toBe(20_000);
      const row = yield* Effect.fromNullishOr(button.closest(".month-week"));
      viewport.append(row);
      button.blur();
      viewport.scrollTop = 300;
      expect(lease.restore()).toBe(true);
      expect(document.activeElement).toBe(button);
      expect(viewport.scrollTop).toBe(300);
    })
);

it.effect(
  "an intentional new pointer or focus target cancels retention and release cannot revive it",
  () =>
    Effect.gen(function* focusIntent() {
      const viewport = yield* viewportFixture;

      const button = yield* Effect.fromNullishOr(
        viewport.querySelector<HTMLButtonElement>(".month-date")
      );

      const other = yield* Effect.fromNullishOr(
        viewport.querySelector<HTMLButtonElement>(".outside-week")
      );

      button.focus();

      const lease = yield* Effect.acquireRelease(
        Effect.sync(() => Option.getOrThrow(retainMonthFocus(viewport))),
        (resource) => Effect.sync(resource.release)
      );

      other.focus();
      expect(lease.restore()).toBe(false);
      expect(document.activeElement).toBe(other);
      button.focus();

      const pointerLease = yield* Effect.acquireRelease(
        Effect.sync(() => Option.getOrThrow(retainMonthFocus(viewport))),
        (resource) => Effect.sync(resource.release)
      );

      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true })
      );
      button.blur();
      expect(pointerLease.restore()).toBe(false);
      pointerLease.release();
      expect(pointerLease.restore()).toBe(false);
    })
);
