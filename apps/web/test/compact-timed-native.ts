import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor } from "@xstate/effect";
import { Effect, Option, Queue } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { bindGestureEvents } from "../src/client/editing/gesture-events.js";
import { gestureMachine } from "../src/client/editing/gesture-machine.js";
import { modelGestureInputs } from "../src/client/editing/gesture-targets.js";
import { view } from "../src/features/app.js";

export const compactResize = Effect.fn("compactResize")(function* compactResize(
  model: AppModel
) {
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

  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 2000, 2000);

  for (const [index, cell] of [
    ...root.querySelectorAll<HTMLElement>(".day-column"),
  ].entries()) {
    cell.getBoundingClientRect = () =>
      new DOMRect(100 + index * 800, 100, 800, 1152);
  }

  const handle = yield* Effect.fromNullishOr(
    root.querySelector<HTMLElement>(
      '.event-chip.selected [data-resize-edge="end"]'
    )
  );

  const inputs = modelGestureInputs(model);
  const actor = yield* createEffectActor(gestureMachine);
  yield* watchActor("calendar.compact.resize", actor);
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      bindGestureEvents({
        actor,
        getTargets: () => inputs.targets,
        root,
        scale: 48,
      })
    ),
    (release) => Effect.sync(release)
  );

  const steps: { type: string; x: number; y: number }[] = [];

  const step = Effect.fn("compactResizeStep")(function* compactResizeStep(
    type: string,
    y: number,
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
              clientX: 200,
              clientY: y,
              isPrimary: true,
              pointerId: 79,
            })
          );
          steps.push({ type, x: 200, y });
        }).pipe(Effect.andThen(Queue.take(notices))),
      (subscription) =>
        Effect.sync(() => {
          subscription.unsubscribe();
        })
    );
  });

  yield* step("pointerdown", 556, handle);
  yield* step("pointermove", 550);
  const snapshot = yield* step("pointermove", 544);
  const preview = yield* Effect.fromNullishOr(snapshot.context.preview);
  const start = yield* Effect.fromNullishOr(snapshot.context.start);

  const projected = update(
    model,
    Message.PreviewedGesture({
      hostKey: Option.getOrThrow(inputs.key),
      personId: Option.getOrThrow(model.person),
      phase: "dragging",
      preview: Option.some(preview),
    })
  ).model;

  return {
    model: projected,
    proof: {
      actorPhase: snapshot.value,
      edge: start.edge,
      endTime: preview.range.endTime,
      standIns: "Node rectangles and hit tests; no browser layout claim",
      startTime: preview.range.startTime,
      steps,
    },
  };
});
