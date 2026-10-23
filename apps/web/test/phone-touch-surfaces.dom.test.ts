import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { bindTouchSurfaces } from "../src/client/editing/touch-surfaces.js";

it.effect(
  "non-passive touch routing belongs to editable surfaces rather than the host and is scoped to their lifetime",
  () =>
    Effect.gen(function* surfaceRouting() {
      const root = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const element = document.createElement("section");
          element.innerHTML =
            '<div id="time-viewport"><div class="day-column"></div></div><div class="all-day"><div class="all-day-cell"></div></div><button class="outside">Outside grid</button>';
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

      const column = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>(".day-column")
      );

      const allDay = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>(".all-day")
      );

      const cell = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>(".all-day-cell")
      );

      const outside = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>(".outside")
      );

      const seen: EventTarget[] = [];

      yield* Effect.scoped(
        Effect.gen(function* scopedSurfaces() {
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              bindTouchSurfaces(root, (event) => {
                if (event.currentTarget !== null) {
                  seen.push(event.currentTarget);
                }
              })
            ),
            (release) => Effect.sync(release)
          );
          column.dispatchEvent(
            new TouchEvent("touchmove", { bubbles: true, cancelable: true })
          );
          cell.dispatchEvent(
            new TouchEvent("touchmove", { bubbles: true, cancelable: true })
          );
          outside.dispatchEvent(
            new TouchEvent("touchmove", { bubbles: true, cancelable: true })
          );
          expect(seen).toEqual([viewport, allDay]);
        })
      );

      column.dispatchEvent(
        new TouchEvent("touchmove", { bubbles: true, cancelable: true })
      );
      cell.dispatchEvent(
        new TouchEvent("touchmove", { bubbles: true, cancelable: true })
      );
      expect(seen).toEqual([viewport, allDay]);
    })
);
