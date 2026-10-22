import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor } from "@xstate/effect";
import { Effect, Option, Queue } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { bindGestureEvents } from "../src/client/editing/gesture-events.js";
import { gestureMachine } from "../src/client/editing/gesture-machine.js";
import { modelGestureInputs } from "../src/client/editing/gesture-targets.js";
import { timeGridGeometry } from "../src/client/time-blocks/grid.js";
import { view } from "../src/features/app.js";
import { minuteToY } from "../src/layout/geometry.js";
import { visibleDays } from "../src/layout/navigation.js";
import { allDaySection } from "../src/layout/presentation.js";
import { zoneColumns } from "../src/layout/time-zones-grid.js";
import { timeBlockDay, timeBlockModel } from "./time-block-fixture.js";
import type { TimeBlockScene } from "./time-block-fixture.js";

export const nativeTimeBlockScene = Effect.fn("nativeTimeBlockScene")(
  function* nativeTimeBlockScene(
    scene: TimeBlockScene,
    width: number,
    theme: "light" | "dark",
    drop?: boolean
  ) {
    const model = timeBlockModel(scene, width, theme);

    const rendered = yield* renderToString(
      { init: () => ({ model }), view },
      { isHydratable: false }
    );

    const container = document.createElement("div");
    container.innerHTML = rendered.html;
    document.body.append(container);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        container.remove();
      })
    );

    const root = yield* Effect.fromNullishOr(
      container.querySelector<HTMLElement>(".time-view")
    );

    const viewport = yield* Effect.fromNullishOr(
      root.querySelector<HTMLElement>("#time-viewport")
    );

    const chip = yield* Effect.fromNullishOr(
      root.querySelector<HTMLElement>(".event-chip.selected")
    );

    const projection = timeGridGeometry(model);
    const days = visibleDays(model.calendar.navigation);
    const columns = zoneColumns(model.calendar.viewportWidth, days.length, 1);
    const left = width <= 1100 ? 185 : 220;
    const bodyTop = 84 + allDaySection(model).height;
    const scrollTop = Math.max(0, minuteToY(projection.grid, 540) - 100);
    viewport.scrollTop = scrollTop;
    viewport.getBoundingClientRect = () =>
      new DOMRect(left, 56, model.calendar.viewportWidth, 904);
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: model.calendar.viewportWidth },
      scrollWidth: { configurable: true, value: columns.total },
    });

    const nodes = [
      ...root.querySelectorAll<HTMLElement>(".day-column[data-day]"),
    ];

    for (const node of nodes) {
      const index = days.indexOf(Number(node.dataset.day));
      node.getBoundingClientRect = () =>
        new DOMRect(
          left + 46 + index * columns.day - viewport.scrollLeft,
          bodyTop - viewport.scrollTop,
          columns.day,
          projection.grid.height
        );
    }

    const column = yield* Effect.fromNullishOr(
      nodes.find((node) => Number(node.dataset.day) === timeBlockDay)
    );

    const rect = column.getBoundingClientRect();
    const x = rect.left + rect.width * 0.8;
    const actor = yield* createEffectActor(gestureMachine);
    yield* watchActor("calendar.time-block.native", actor);
    const { targets } = modelGestureInputs(model);
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        bindGestureEvents({
          actor,
          getTargets: () => targets,
          grid: projection.grid,
          root,
          scale: projection.scale,
        })
      ),
      (release) => Effect.sync(release)
    );
    const steps: { type: string; minute: number; y: number }[] = [];

    const step = Effect.fn("timeBlockPointerStep")(function* step(
      type: string,
      minute: number,
      receiver: EventTarget
    ) {
      const notices =
        yield* Queue.unbounded<ReturnType<typeof actor.getSnapshot>>();

      return yield* Effect.acquireUseRelease(
        Effect.sync(() =>
          actor.subscribe((snapshot) => {
            Queue.offerUnsafe(notices, snapshot);
          })
        ),
        () =>
          Effect.sync(() => {
            const y =
              column.getBoundingClientRect().top +
              minuteToY(projection.grid, minute);

            receiver.dispatchEvent(
              new PointerEvent(type, {
                bubbles: true,
                button: 0,
                cancelable: true,
                clientX: x,
                clientY: y,
                isPrimary: true,
                pointerId: 81,
              })
            );
            steps.push({ minute, type, y });
          }).pipe(Effect.andThen(Queue.take(notices))),
        (subscription) =>
          Effect.sync(() => {
            subscription.unsubscribe();
          })
      );
    });

    yield* step("pointerdown", 645, chip);
    const dragging = yield* step("pointermove", 825, window);
    const preview = yield* Effect.fromNullishOr(dragging.context.preview);

    const projected = update(
      model,
      Message.PreviewedGesture({
        hostKey: Option.getOrThrow(modelGestureInputs(model).key),
        personId: Option.getOrThrow(model.person),
        phase: "dragging",
        preview: Option.some(preview),
      })
    ).model;

    const completed =
      drop === true
        ? (yield* step("pointerup", 825, window)).context.completed
        : undefined;

    return {
      completed,
      model: projected,
      phase: dragging.value,
      preview,
      projection,
      steps,
    };
  }
);
