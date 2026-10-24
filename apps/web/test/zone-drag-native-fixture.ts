import { Effect, Layer, Option, Predicate, Queue, Stream } from "effect";
import { Runtime, Subscription } from "foldkit";
import { vi } from "vitest";

import { Model, update } from "../src/client/app.js";
import type { AppMessage, AppModel } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { EditingRuntime } from "../src/client/editing/runtime.js";
import { keyboardStream } from "../src/client/keyboard/subscription.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { SearchRuntime } from "../src/client/search/runtime.js";
import { timeGrid } from "../src/features/time-grid.js";
import { unusedBrowserLayers } from "./browser-runtime-fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";
import { timeZonesFixture } from "./time-zones-fixture.js";

const point = (
  type: string,
  x: number,
  receiver: EventTarget = window,
  pointerId = 91,
  y = 14
) => {
  receiver.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: x,
      clientY: y,
      isPrimary: true,
      pointerId,
    })
  );
};

export const untilZoneDom = <A>(read: () => A | undefined) =>
  Effect.callback<A>((resume) => {
    const check = () => {
      const value = read();

      if (value !== undefined) {
        resume(Effect.succeed(value));
      }
    };

    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    check();

    return Effect.sync(() => {
      observer.disconnect();
    });
  });

export const mountZoneDragScene = Effect.fn("mountZoneDragScene")(
  function* mountZoneDragScene(
    width = 1440,
    theme: "light" | "dark" = "light"
  ) {
    const base = timeZonesFixture(
      true,
      theme === "dark",
      width - (width <= 1000 ? 445 : 520)
    );

    let current: AppModel = {
      ...base,
      upcoming: {
        ...base.upcoming,
        data: RemoteEvents.Success({ data: { events: [], versions: [] } }),
      },
    };

    const messages = yield* Queue.unbounded<AppMessage>();
    let saved = 0;
    const captures = new Set<number>();

    const container = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const element = document.createElement("div");
        element.id = "zone-drag-runtime";
        document.body.append(element);
        vi.stubGlobal(
          "ResizeObserver",
          class {
            active = false;
            observe() {
              this.active = true;
            }
            disconnect() {
              this.active = false;
            }
            unobserve() {
              this.active = false;
            }
          }
        );

        return element;
      }),
      (element) =>
        Effect.sync(() => {
          document.querySelector("#zone-drag-runtime")?.remove();
          element.remove();
          vi.unstubAllGlobals();
        })
    );

    const program = Runtime.makeElement({
      Model,
      container,
      devTools: false,
      init: () => ({ model: current }),
      resources: Layer.mergeAll(
        unusedBrowserLayers,
        Layer.succeed(CalendarSearchClient, unexpectedSearchClient),
        Layer.succeed(SearchRuntime, {
          dispatchPage: () => Effect.die("Zone dragging must not page search"),
          observe: () => Stream.die("Zone dragging must not start search"),
          observePages: () =>
            Stream.die("Zone dragging must not start search pages"),
        }),
        Layer.succeed(
          EditingRuntime,
          EditingRuntime.of({
            connect: () => Effect.die("Zone dragging must not start editing"),
            dispatch: () =>
              Effect.die("Zone dragging must not dispatch editing"),
          })
        )
      ),
      subscriptions: Subscription.make<typeof Model.Type, AppMessage>()(() => ({
        keyboard: Subscription.persistentEntry(keyboardStream(() => current)),
      })),
      update: (model, message) => {
        const result = update(model, message);
        current = result.model;

        if (Predicate.isTagged(message, "SavedPreferences")) {
          saved += 1;
        }

        Queue.offerUnsafe(messages, message);

        return result;
      },
      view: (model, h) => timeGrid(model, h),
    });

    yield* Effect.acquireRelease(
      Effect.sync(() => Runtime.embed(program)),
      (mounted) =>
        Effect.sync(() => {
          mounted.dispose();
        })
    );

    const notice = (
      tag: "PreparedZoneDragHost" | "SavedPreferences" | "TimeZoneAction"
    ) =>
      Stream.fromQueue(messages).pipe(
        Stream.filter((message) => Predicate.isTagged(message, tag)),
        Stream.runHead,
        Effect.map(Option.getOrThrow)
      );

    yield* notice("PreparedZoneDragHost");

    const root = yield* Effect.fromNullishOr(
      document.querySelector<HTMLElement>(".day-headers")
    );

    root.setPointerCapture = (id) => {
      captures.add(id);
    };

    root.hasPointerCapture = (id) => captures.has(id);
    root.releasePointerCapture = (id) => {
      captures.delete(id);
    };

    for (const header of root.querySelectorAll<HTMLElement>(".zone-header")) {
      header.getBoundingClientRect = () =>
        new DOMRect(
          [...root.querySelectorAll(".zone-header")].indexOf(header) * 46,
          0,
          46,
          28
        );
    }

    const first = yield* Effect.fromNullishOr(
      root.querySelector<HTMLButtonElement>("button[data-zone-drag-id]")
    );

    const press = () =>
      Effect.sync(() => {
        point("pointerdown", 23, first);
      }).pipe(
        Effect.andThen(
          untilZoneDom(() =>
            root.dataset.zoneDragPhase === "pressed" ? true : undefined
          )
        )
      );

    return {
      captures,
      container,
      first,
      model: () => current,
      notice,
      point,
      press,
      root,
      saves: () => saved,
    };
  }
);

export const nativeZoneDragScene = Effect.fn("nativeZoneDragScene")(
  function* nativeZoneDragScene(
    phase: "marker" | "drop",
    width: number,
    theme: "light" | "dark"
  ) {
    const h = yield* mountZoneDragScene(width, theme);
    yield* h.press();
    h.point("pointermove", 88);
    yield* untilZoneDom(
      () => h.root.querySelector(".zone-insert-marker") ?? undefined
    );
    const capturedDuringDrag = h.captures.has(91);

    if (phase === "drop") {
      h.point("pointerup", 88);
      yield* h.notice("SavedPreferences");
      yield* untilZoneDom(() =>
        h.root.querySelector(".zone-insert-marker") === null &&
        h.root.querySelector<HTMLElement>(".zone-header")?.dataset.zoneId ===
          "Europe/London"
          ? true
          : undefined
      );
    }

    return { capturedDuringDrag, model: h.model(), saves: h.saves() };
  }
);
