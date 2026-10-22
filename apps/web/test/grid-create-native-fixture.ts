import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor } from "@xstate/effect";
import { Effect, Queue } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { bindGestureEvents } from "../src/client/editing/gesture-events.js";
import { gestureMachine } from "../src/client/editing/gesture-machine.js";
import { timeGridGeometry } from "../src/client/time-blocks/grid.js";
import { view } from "../src/features/app.js";
import { minuteToY } from "../src/layout/geometry.js";
import { visibleDays } from "../src/layout/navigation.js";
import { zoneColumns } from "../src/layout/time-zones-grid.js";
import { openCreatedGridDraft } from "./grid-create-runtime-fixture.js";
import { timeBlockDay, timeBlockModel } from "./time-block-fixture.js";

export const nativeCreatedGridDraft = Effect.fn("nativeCreatedGridDraft")(
  function* nativeCreatedGridDraft(
    alt: boolean,
    width: number,
    theme: "light" | "dark"
  ) {
    const initial = timeBlockModel("week", width, theme);

    const model = {
      ...initial,
      calendar: { ...initial.calendar, selected: [] },
      settings: {
        ...initial.settings,
        timeBlocks: { blocks: [], enabled: false },
      },
    };

    const rendered = yield* renderToString(
      { init: () => ({ model }), view },
      { isHydratable: false }
    );

    const container = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const element = document.createElement("div");
        element.innerHTML = rendered.html;
        document.body.append(element);

        return element;
      }),
      (element) =>
        Effect.sync(() => {
          element.remove();
        })
    );

    const root = yield* Effect.fromNullishOr(
      container.querySelector<HTMLElement>(".time-view")
    );

    const { grid, scale } = timeGridGeometry(model);
    const days = visibleDays(model.calendar.navigation);
    const columns = zoneColumns(model.calendar.viewportWidth, days.length, 1);

    const nodes = [
      ...root.querySelectorAll<HTMLElement>(".day-column[data-day]"),
    ];

    for (const node of nodes) {
      const index = days.indexOf(Number(node.dataset.day));
      node.getBoundingClientRect = () =>
        new DOMRect(231 + index * columns.day, 100, columns.day, grid.height);
    }

    const column = yield* Effect.fromNullishOr(
      nodes.find((node) => Number(node.dataset.day) === timeBlockDay)
    );

    const actor = yield* createEffectActor(gestureMachine);
    yield* watchActor("calendar.grid-double-click.fixture", actor);
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        bindGestureEvents({ actor, getTargets: () => [], grid, root, scale })
      ),
      (release) => Effect.sync(release)
    );

    const step = Effect.fn("gridCreatePointerStep")(function* step(
      type: string,
      at: number
    ) {
      const queue =
        yield* Queue.unbounded<ReturnType<typeof actor.getSnapshot>>();

      return yield* Effect.acquireUseRelease(
        Effect.sync(() =>
          actor.subscribe((snapshot) => {
            Queue.offerUnsafe(queue, snapshot);
          })
        ),
        () =>
          Effect.sync(() => {
            const rect = column.getBoundingClientRect();

            const event = new PointerEvent(type, {
              altKey: alt,
              bubbles: true,
              button: 0,
              cancelable: true,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + minuteToY(grid, 547),
              isPrimary: true,
              pointerId: 82,
            });

            Object.defineProperty(event, "timeStamp", { value: at });
            (type === "pointerdown" ? column : window).dispatchEvent(event);
          }).pipe(Effect.andThen(Queue.take(queue))),
        (subscription) =>
          Effect.sync(() => {
            subscription.unsubscribe();
          })
      );
    });

    yield* step("pointerdown", 100);
    const first = yield* step("pointerup", 101);

    if (first.context.completed !== undefined) {
      return yield* Effect.die(
        "A single grid click unexpectedly created a draft"
      );
    }

    yield* step("pointerdown", 300);
    const second = yield* step("pointerup", 301);
    const gesture = yield* Effect.fromNullishOr(second.context.completed);
    const draft = yield* openCreatedGridDraft(model, gesture);

    return { gesture, model: draft, singleClickCreated: false };
  }
);
