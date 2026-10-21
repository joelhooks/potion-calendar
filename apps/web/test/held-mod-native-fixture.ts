import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor } from "@xstate/effect";
import { Effect, Option, Queue } from "effect";
import { renderToString } from "foldkit/experimental/server";

import type { AppModel } from "../src/client/app.js";
import { bindGestureEvents } from "../src/client/editing/gesture-events.js";
import { gestureMachine } from "../src/client/editing/gesture-machine.js";
import { modelGestureInputs } from "../src/client/editing/gesture-targets.js";
import type { MonthGestureRefused } from "../src/client/month/gesture.js";
import { bindSelectionEvents } from "../src/client/selection/events.js";
import { rectangleMachine } from "../src/client/selection/machine.js";
import { view } from "../src/features/app.js";
import { dayFromIso } from "../src/layout/navigation.js";

export const heldModNativeGesture = Effect.fn("heldModNativeGesture")(
  function* heldModNativeGesture(input: {
    readonly model: AppModel;
    readonly resize: boolean;
    readonly downMod: boolean;
    readonly dropMod: boolean;
    readonly shift: boolean;
    readonly dropShift?: boolean;
    readonly platform: "MacIntel" | "Win32";
  }) {
    const rendered = yield* renderToString(
      { init: () => ({ model: input.model }), view },
      { isHydratable: false }
    );

    const container = document.createElement("div");
    container.innerHTML = rendered.html;
    document.body.append(container);
    const oldPlatform = Object.getOwnPropertyDescriptor(navigator, "platform");
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: input.platform,
    });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        container.remove();

        if (oldPlatform === undefined) {
          Reflect.deleteProperty(navigator, "platform");
        } else {
          Object.defineProperty(navigator, "platform", oldPlatform);
        }
      })
    );

    const month = input.model.calendar.navigation.mode === "month";

    const root = yield* Effect.fromNullishOr(
      container.querySelector<HTMLElement>(
        month ? ".month-view" : ".calendar-view"
      )
    );

    const [selectedKey] = input.model.calendar.selected;

    const chip = yield* Effect.fromNullishOr(
      [...root.querySelectorAll<HTMLElement>(".event-chip")].find(
        (item) => item.dataset.eventKey === selectedKey
      )
    );

    const day = dayFromIso("2026-10-21");

    const dayElements = [
      ...root.querySelectorAll<HTMLElement>(
        month ? ".month-cell[data-day]" : ".day-column[data-day]"
      ),
    ];

    for (const element of dayElements) {
      const offset = Number(element.dataset.day) - day;
      element.getBoundingClientRect = () =>
        new DOMRect(500 + offset * 100, 0, 100, month ? 120 : 1440);
    }

    const viewport = yield* Effect.fromNullishOr(
      root.querySelector<HTMLElement>(
        month ? "#month-viewport" : "#time-viewport"
      )
    );

    viewport.getBoundingClientRect = () => new DOMRect(0, 0, 2000, 1500);
    const actor = yield* createEffectActor(gestureMachine);
    const selection = yield* createEffectActor(rectangleMachine);
    yield* watchActor("calendar.held-mod.gesture", actor);
    yield* watchActor("calendar.held-mod.selection", selection);
    const inputs = modelGestureInputs(input.model);
    let refusal: typeof MonthGestureRefused.fields.reason.Type | undefined;
    let selectionChanges = 0;
    const clickRoutes = yield* Queue.unbounded<"gesture" | "selection">();
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        bindSelectionEvents({
          actor: selection,
          preview: (box) => {
            if (Option.isSome(box)) {
              selectionChanges += 1;
            }
          },
          replace: () => {
            selectionChanges += 1;
          },
          root,
          toggle: () => {
            selectionChanges += 1;
            Queue.offerUnsafe(clickRoutes, "selection");
          },
        })
      ),
      (release) => Effect.sync(release)
    );
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        bindGestureEvents({
          actor,
          getTargets: () => inputs.targets,
          refused: (reason) => {
            refusal = reason;
          },
          root,
          scale: 60,
        })
      ),
      (release) => Effect.sync(release)
    );

    const handle = input.resize
      ? yield* Effect.fromNullishOr(
          chip.querySelector<HTMLElement>('[data-resize-edge="end"]')
        )
      : chip;

    const origin = yield* Effect.fromNullishOr(
      dayElements.find((element) => Number(element.dataset.day) === day)
    );

    const destination = month
      ? yield* Effect.fromNullishOr(
          dayElements.find((element) => Number(element.dataset.day) === day + 1)
        )
      : origin;

    const pointerLog: {
      type: string;
      metaKey: boolean;
      ctrlKey: boolean;
      shiftKey: boolean;
    }[] = [];

    const pointer = (
      type: string,
      target: Element,
      mod: boolean,
      moved: boolean
    ) => {
      let clientY = input.resize ? 600 : 540;

      if (moved) {
        clientY = 660;
      }

      if (month) {
        clientY = 40;
      }

      const event = new PointerEvent(type, {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: month && moved ? 650 : 550,
        clientY,
        ctrlKey: input.platform === "Win32" && mod,
        isPrimary: true,
        metaKey: input.platform === "MacIntel" && mod,
        pointerId: 1,
        shiftKey: moved ? (input.dropShift ?? input.shift) : input.shift,
      });

      target.dispatchEvent(event);
      pointerLog.push({
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        type,
      });
    };

    const step = Effect.fn("heldModNativeStep")(function* step(
      type: string,
      target: Element,
      mod: boolean,
      moved: boolean,
      state: "armed" | "dragging" | "idle"
    ) {
      const snapshots =
        yield* Queue.unbounded<ReturnType<typeof actor.getSnapshot>>();

      yield* Effect.acquireUseRelease(
        Effect.sync(() =>
          actor.subscribe((snapshot) => {
            if (snapshot.matches(state)) {
              Queue.offerUnsafe(snapshots, snapshot);
            }
          })
        ),
        () =>
          Effect.sync(() => {
            let bubbled = false;

            const observe = () => {
              bubbled = true;
            };

            window.addEventListener(type, observe);

            try {
              pointer(type, target, mod, moved);
            } finally {
              window.removeEventListener(type, observe);
            }

            if (!bubbled) {
              throw new Error(
                "Selection intercepted the held-modifier pointer"
              );
            }
          }).pipe(Effect.andThen(Queue.take(snapshots))),
        (subscription) =>
          Effect.sync(() => {
            subscription.unsubscribe();
          })
      );
    });

    if (
      inputs.targets.find((item) => item.key === selectedKey)?.editable ===
      false
    ) {
      yield* Effect.sync(() => {
        pointer("pointerdown", handle, input.downMod, false);
      });
    } else {
      yield* step("pointerdown", handle, input.downMod, false, "armed");
      yield* step("pointermove", destination, input.dropMod, true, "dragging");
      yield* step("pointerup", destination, input.dropMod, true, "idle");
    }

    let clickOwner: "gesture" | "selection" | undefined;

    if (actor.getSnapshot().context.completed !== undefined) {
      clickOwner = yield* Effect.acquireUseRelease(
        Effect.sync(() =>
          actor.subscribe((snapshot) => {
            if (
              !snapshot.context.blockClick &&
              snapshot.context.completed !== undefined
            ) {
              Queue.offerUnsafe(clickRoutes, "gesture");
            }
          })
        ),
        () =>
          Effect.sync(() =>
            chip.dispatchEvent(
              new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                ctrlKey: input.platform === "Win32" && input.dropMod,
                metaKey: input.platform === "MacIntel" && input.dropMod,
                shiftKey: input.dropShift ?? input.shift,
              })
            )
          ).pipe(Effect.andThen(Queue.take(clickRoutes))),
        (subscription) =>
          Effect.sync(() => {
            subscription.unsubscribe();
          })
      );
    }

    return {
      clickOwner,
      completed: actor.getSnapshot().context.completed,
      hostKey: Option.getOrThrow(inputs.key),
      platform: input.platform,
      pointerLog,
      refusal,
      selectionChanges,
      state: actor.getSnapshot().value,
    };
  }
);
