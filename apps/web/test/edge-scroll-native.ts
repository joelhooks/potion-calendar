import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor } from "@xstate/effect";
import { Effect, Option, Queue } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { bindGestureEvents } from "../src/client/editing/gesture-events.js";
import { gestureMachine } from "../src/client/editing/gesture-machine.js";
import { modelGestureInputs } from "../src/client/editing/gesture-targets.js";
import { displayedZones } from "../src/client/time-zones/model.js";
import { view } from "../src/features/app.js";
import { hourHeight } from "../src/layout/geometry.js";
import { isoFromDay } from "../src/layout/navigation.js";
import { allDaySection } from "../src/layout/presentation.js";
import { zoneColumns } from "../src/layout/time-zones-grid.js";
import { edgeFirstDay, edgeSceneModel } from "./edge-scroll-fixture.js";
import type { EdgeScene } from "./edge-scroll-fixture.js";

const previewDateFor = (
  range: { readonly startDate: string; readonly endDate: string },
  allDay: boolean,
  direction: "left" | "right"
): string =>
  allDay && direction === "right" ? range.endDate : range.startDate;

export const nativeEdgeScene = Effect.fn("nativeEdgeScene")(
  function* nativeEdgeScene(input: {
    readonly scene: EdgeScene;
    readonly width: number;
    readonly theme: "light" | "dark";
    readonly direction?: "left" | "right";
    readonly drop?: boolean;
    readonly edgeDistance?: number;
  }) {
    const direction = input.direction ?? "right";

    const model = edgeSceneModel(
      input.scene,
      input.width,
      input.theme,
      direction
    );

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

    const allDay = input.scene === "all-day-resize";
    const { days } = model.calendar.navigation;
    const zones = displayedZones(model.timeZones).length;
    const columns = zoneColumns(model.calendar.viewportWidth, days, zones);
    const left = input.width <= 1100 ? 185 : 220;
    const width = input.width - left - 300;
    const frame = new DOMRect(left, 56, width, 904);

    const scale = hourHeight(
      model.calendar.zoom,
      model.calendar.viewport,
      allDaySection(model).height
    );

    viewport.getBoundingClientRect = () => frame;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: width },
      scrollWidth: { configurable: true, value: columns.total },
    });
    viewport.scrollTop = 240;
    const maximum = Math.max(0, columns.total - width);
    viewport.scrollLeft = direction === "left" ? maximum : 0;
    const before = viewport.scrollLeft;
    const topBefore = viewport.scrollTop;

    const dayElements = [
      ...root.querySelectorAll<HTMLElement>(
        ".day-column[data-day],.all-day-cell[data-day]"
      ),
    ];

    for (const element of dayElements) {
      const offset = Number(element.dataset.day) - edgeFirstDay;
      const row = element.classList.contains("all-day-cell");
      element.getBoundingClientRect = () =>
        new DOMRect(
          left + zones * 46 + offset * columns.day - viewport.scrollLeft,
          row ? 84 : 84 + allDaySection(model).height - viewport.scrollTop,
          columns.day,
          row ? allDaySection(model).height : 24 * scale
        );
    }

    const cells = dayElements.filter((element) =>
      element.classList.contains(allDay ? "all-day-cell" : "day-column")
    );

    const destination = yield* Effect.fromNullishOr(
      direction === "left" ? cells[0] : cells.at(-1)
    );

    const initialDestination = destination.getBoundingClientRect();

    const clipped =
      direction === "left"
        ? initialDestination.right <= frame.left + zones * 46
        : initialDestination.left >= frame.right;

    const chip = yield* Effect.fromNullishOr(
      root.querySelector<HTMLElement>(".event-chip.selected")
    );

    const target = allDay
      ? yield* Effect.fromNullishOr(
          chip.querySelector<HTMLElement>(
            direction === "left"
              ? '[data-resize-edge="start"]'
              : '[data-resize-edge="end"]'
          )
        )
      : chip;

    const rightOrigin = allDay ? 2 : 0;
    const originIndex = direction === "left" ? days - 3 : rightOrigin;
    const origin = yield* Effect.fromNullishOr(cells[Math.max(0, originIndex)]);
    const originBox = origin.getBoundingClientRect();
    const originX = originBox.left + columns.day / 2;
    const y = allDay ? 94 : originBox.top + 9 * scale;
    const actor = yield* createEffectActor(gestureMachine);
    yield* watchActor("calendar.edge-scroll.native", actor);
    const inputs = modelGestureInputs(model);

    const steps: { type: string; x: number; y: number; scrollLeft: number }[] =
      [];

    yield* Effect.acquireRelease(
      Effect.sync(() =>
        bindGestureEvents({
          actor,
          getTargets: () => inputs.targets,
          root,
          scale,
        })
      ),
      (release) => Effect.sync(release)
    );

    const step = Effect.fn("edgePointerStep")(function* edgePointerStep(
      type: string,
      x: number,
      receiver: EventTarget = window
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
            receiver.dispatchEvent(
              new PointerEvent(type, {
                bubbles: true,
                button: 0,
                cancelable: true,
                clientX: x,
                clientY: y,
                isPrimary: true,
                pointerId: 71,
              })
            );
            steps.push({ scrollLeft: viewport.scrollLeft, type, x, y });
          }).pipe(Effect.andThen(Queue.take(notices))),
        (subscription) =>
          Effect.sync(() => {
            subscription.unsubscribe();
          })
      );
    });

    yield* step("pointerdown", originX, target);
    yield* step("pointermove", originX + 6);
    const edgeDistance = input.edgeDistance ?? 160;

    const edgeX =
      direction === "left"
        ? frame.left - edgeDistance
        : frame.right + edgeDistance;

    const edged = yield* step("pointermove", edgeX);

    const edgeColumn = cells.find((element) => {
      const rect = element.getBoundingClientRect();

      return edgeX >= rect.left && edgeX < rect.right;
    });

    const edgeColumnDate =
      edgeColumn === undefined
        ? undefined
        : isoFromDay(Number(edgeColumn.dataset.day));

    const edgePreview = yield* Effect.fromNullishOr(edged.context.preview);

    const edgePreviewDate = previewDateFor(
      edgePreview.range,
      allDay,
      direction
    );

    const settledX =
      direction === "left"
        ? frame.left + zones * 46 + 4
        : Math.min(frame.right, destination.getBoundingClientRect().right) - 4;

    const snapshot = yield* step("pointermove", settledX);
    const preview = yield* Effect.fromNullishOr(snapshot.context.preview);

    const under = yield* Effect.fromNullishOr(
      cells.find((element) => {
        const rect = element.getBoundingClientRect();

        return settledX >= rect.left && settledX < rect.right;
      })
    );

    const columnDate = isoFromDay(Number(under.dataset.day));

    const previewDate = previewDateFor(preview.range, allDay, direction);

    const projected = update(
      model,
      Message.PreviewedGesture({
        hostKey: Option.getOrThrow(inputs.key),
        personId: Option.getOrThrow(model.person),
        phase: "dragging",
        preview: Option.some(preview),
      })
    ).model;

    const completed =
      input.drop === true
        ? (yield* step("pointerup", settledX)).context.completed
        : undefined;

    return {
      completed,
      model: projected,
      proof: {
        actorPhase: snapshot.value,
        after: viewport.scrollLeft,
        allDay,
        before,
        clipped,
        columnDate,
        columnDay: Number(under.dataset.day),
        columnWidth: columns.day,
        contentWidth: columns.total,
        dayCount: days,
        direction,
        edgeColumnDate,
        edgePreviewDate,
        frameLeft: left,
        maximum,
        modelWidth: model.calendar.viewportWidth,
        previewDate,
        previewRange: preview.range,
        scale,
        scene: input.scene,
        steps,
        topAfter: viewport.scrollTop,
        topBefore,
        viewportWidth: width,
        zones,
      },
    };
  }
);
