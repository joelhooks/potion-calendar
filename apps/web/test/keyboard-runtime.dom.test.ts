import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Option, Stream } from "effect";
import { renderToString } from "foldkit/experimental/server";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { PrepareTimeGrid } from "../src/client/grid-mount.js";
import { formatKey } from "../src/client/keyboard/hints.js";
import { view } from "../src/features/app.js";
import { maximumDisplayedDays } from "../src/layout/navigation.js";
import { keyboardDensityFixture, keyboardFixture } from "./keyboard-fixture.js";

const render = (model: AppModel) =>
  renderToString(
    { init: () => ({ model }), view },
    { isHydratable: false }
  ).pipe(
    Effect.map(({ html }) => new DOMParser().parseFromString(html, "text/html"))
  );

it.effect(
  "one platform formatter renders the same command binding in menu, page and button",
  () =>
    Effect.gen(function* platformHints() {
      const spy = vi.spyOn(navigator, "platform", "get");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          spy.mockRestore();
        })
      );
      const base = keyboardFixture();

      for (const [platform, label] of [
        ["MacIntel", "⌘K"],
        ["Win32", "Ctrl+K"],
      ] as const) {
        spy.mockReturnValue(platform);

        const menu = yield* render(
          update(base, Message.KeyboardAction({ id: "commands" })).model
        );

        const page = yield* render(
          update(base, Message.KeyboardAction({ id: "shortcuts" })).model
        );

        const grid = yield* render(base);
        expect(
          menu.querySelector("[data-command-trigger-hint]")?.textContent
        ).toBe(label);
        expect(
          page.querySelector('[data-shortcut-id="commands"] kbd')?.textContent
        ).toBe(label);
        expect(grid.querySelector("#command-menu-button")?.textContent).toBe(
          `Commands · ${label}`
        );
        expect(menu.querySelector("footer")?.textContent).toBe(
          "↑↓ Navigate · ↵ Select · Esc Close"
        );
      }

      for (const [key, label] of [
        ["Mod+z", "⌘Z"],
        ["Mod+d", "⌘D"],
        ["Alt+t", "⌥T"],
        ["Shift+n", "⇧N"],
        ["e t", "E then T"],
      ] as const) {
        expect(formatKey(key, "MacIntel")).toBe(label);
      }
    }).pipe(Effect.scoped)
);

const unobservedResize = (): never => {
  throw new Error("observer was not acquired");
};

it.effect(
  "the actual ResizeObserver mount remeasures after 31-day navigation closes details",
  () =>
    Effect.gen(function* resizedGrid() {
      const base = keyboardFixture();
      const dom = yield* render(base);
      const element = dom.querySelector<HTMLElement>(".time-view");

      if (element === null) {
        return yield* Effect.die(new Error("fixture time grid is missing"));
      }

      let width = base.calendar.viewportWidth;
      Object.defineProperty(element, "clientWidth", { get: () => width });

      const firstMeasurement =
        yield* Deferred.make<ReturnType<typeof Message.MeasuredViewport>>();

      let resize: () => void = unobservedResize;

      const disconnect = vi.fn();

      class ObservedResize implements ResizeObserver {
        observed: Element | undefined;
        constructor(onResize: ResizeObserverCallback) {
          resize = () => {
            onResize([], this);
          };
        }
        observe(target: Element): void {
          this.observed = target;
          expect(this.observed).toBe(element);
        }
        unobserve(): void {
          this.observed = undefined;
        }
        disconnect(): void {
          disconnect();
          this.observed = undefined;
        }
      }

      vi.stubGlobal("ResizeObserver", ObservedResize);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          vi.unstubAllGlobals();
        })
      );

      const waiting = yield* Effect.forkChild(
        PrepareTimeGrid({ initialMinute: 540, initialScale: 48 })
          .f(element, Stream.never)
          .pipe(
            Stream.tap((message) =>
              Deferred.succeed(firstMeasurement, message)
            ),
            Stream.take(2),
            Stream.runCollect
          )
      );

      yield* Deferred.await(firstMeasurement);
      width = 1220;
      resize();
      const messages = yield* Fiber.join(waiting);
      expect(messages).toHaveLength(2);
      const [initial, measured] = messages;

      if (initial === undefined || measured === undefined) {
        return yield* Effect.die(
          new Error("observer measurements were not delivered")
        );
      }

      expect(initial.width).toBe(920);
      expect(measured.width).toBe(1220);
      let { model } = update(base, initial);
      ({ model } = update(
        model,
        Message.ClickedView({ days: maximumDisplayedDays, mode: "days" })
      ));
      ({ model } = update(model, measured));
      model = {
        ...model,
        calendar: { ...model.calendar, reads: base.calendar.reads },
      };
      expect(Option.isNone(model.calendar.selected)).toBe(true);
      const rendered = yield* render(model);

      const gridWidth = Number(
        (
          rendered.querySelector<HTMLElement>(".day-headers")?.style.width ??
          "NaN"
        ).replace("px", "")
      );

      expect(gridWidth).toBeGreaterThanOrEqual(width);
      expect(gridWidth - width).toBeLessThan(maximumDisplayedDays);
      expect(rendered.querySelectorAll(".event-chip").length).toBeGreaterThan(
        0
      );
      expect(disconnect).toHaveBeenCalledOnce();
      const dense = keyboardDensityFixture();
      expect(dense.calendar.viewportWidth).toBe(width);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);
