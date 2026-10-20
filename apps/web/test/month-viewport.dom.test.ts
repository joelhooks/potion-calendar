import { expect, it } from "@effect/vitest";
import { Effect, Option, Stream } from "effect";
import { vi } from "vitest";

import { Message } from "../src/client/app.js";
import { PrepareMonthViewport } from "../src/client/month/viewport.js";

it.effect(
  "month measures its actual viewport without time-grid scrolling and disposes its observer",
  () =>
    Effect.gen(function* measureMonth() {
      let observations = 0;
      let releases = 0;

      class Observer {
        active = false;
        observe() {
          this.active = true;
          observations += 1;
        }
        disconnect() {
          if (this.active) {
            releases += 1;
          }

          this.active = false;
        }
      }

      const root = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const element = document.createElement("section");
          const viewport = document.createElement("div");
          viewport.id = "month-viewport";
          element.append(viewport);
          Object.defineProperties(element, {
            clientHeight: { value: 521 },
            clientWidth: { value: 900 },
          });
          Object.defineProperties(viewport, {
            clientWidth: { value: 885 },
            offsetWidth: { value: 900 },
          });
          viewport.scrollTop = 179;
          document.body.append(element);
          vi.stubGlobal("ResizeObserver", Observer);

          return element;
        }),
        (element) =>
          Effect.sync(() => {
            element.remove();
            vi.unstubAllGlobals();
          })
      );

      const measured = yield* PrepareMonthViewport()
        .f(root, Stream.empty)
        .pipe(Stream.runHead);

      expect(Option.getOrThrow(measured)).toEqual(
        Message.MeasuredViewport({ gutter: 15, height: 521, width: 885 })
      );
      expect(observations).toBe(1);
      expect(releases).toBe(1);
      expect(root.querySelector("#month-viewport")?.scrollTop).toBe(179);
    })
);
