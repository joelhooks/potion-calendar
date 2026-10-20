import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { watchActor } from "@calendar/capability/actor-watch";
import { expect, it } from "@effect/vitest";
import { createEffectActor } from "@xstate/effect";
import { Effect, Option, Queue, Schema } from "effect";

import { eventKey, RemoteEvents } from "../src/client/calendar-state.js";
import { EditorRequest } from "../src/client/editing/editor-session-model.js";
import { bindGestureEvents } from "../src/client/editing/gesture-events.js";
import { gestureMachine } from "../src/client/editing/gesture-machine.js";
import { GestureTarget } from "../src/client/editing/gesture-model.js";
import { EditingCommand } from "../src/client/editing/runtime.js";
import { completeGesture } from "../src/client/editing/update.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { editorOriginal } from "./editor-fixture.js";
import { fixtureSelection } from "./fixture.js";

const day = dayFromIso("2026-10-19");

const target = GestureTarget.make({
  allDay: false,
  editable: true,
  end: day * 1440 + 600,
  event: editorOriginal,
  key: eventKey(editorOriginal),
  start: day * 1440 + 540,
});

const currentGestureModel = (event: CalendarEventValue | null) => {
  const model = fixtureSelection();

  return {
    ...model,
    calendar: {
      ...model.calendar,
      mergeDuplicates: false,
      reads: model.calendar.reads.map((read) =>
        read.accountId === "work"
          ? {
              ...read,
              events: RemoteEvents.Success({
                data: { events: event === null ? [] : [event], versions: [] },
              }),
            }
          : read
      ),
      selected: Option.some(target.key),
    },
  };
};

const harness = Effect.fn("nativeGestureHarness")(
  function* nativeGestureHarness(withEvent: boolean) {
    const root = document.createElement("div");
    root.innerHTML = `<div id="time-viewport"><div class="day-column" data-day="${day}">${withEvent ? '<button class="event-chip selected" data-event-key="fixture-chip"><span data-resize-edge="end"></span>Event</button>' : ""}</div></div>`;
    document.body.append(root);
    const chip = root.querySelector<HTMLElement>(".event-chip");

    if (chip !== null) {
      chip.dataset.eventKey = target.key;
    }

    let targets: readonly (typeof GestureTarget.Type)[] = withEvent
      ? [target]
      : [];

    const column = yield* Effect.fromNullishOr(
      root.querySelector<HTMLElement>(".day-column")
    );

    column.getBoundingClientRect = () => new DOMRect(100, 0, 100, 1440);

    const actor = yield* createEffectActor(gestureMachine);
    yield* watchActor("calendar.gesture.native.test", actor);
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        bindGestureEvents({
          actor,
          getTargets: () => targets,
          root,
          scale: 60,
        })
      ),
      (release) =>
        Effect.sync(() => {
          release();
          root.remove();
        })
    );

    const dispatch = Effect.fn("nativePointerStep")(function* nativePointerStep(
      type: string,
      y: number,
      element: EventTarget = window,
      alt?: boolean,
      x?: number
    ) {
      const snapshots =
        yield* Queue.unbounded<ReturnType<typeof actor.getSnapshot>>();

      return yield* Effect.acquireUseRelease(
        Effect.sync(() =>
          actor.subscribe((snapshot) => {
            Queue.offerUnsafe(snapshots, snapshot);
          })
        ),
        () =>
          Effect.sync(() => {
            element.dispatchEvent(
              new PointerEvent(type, {
                altKey: alt === true,
                bubbles: true,
                button: 0,
                cancelable: true,
                clientX: x ?? 150,
                clientY: y,
                isPrimary: true,
                pointerId: 1,
              })
            );
          }).pipe(Effect.andThen(Queue.take(snapshots))),
        (subscription) =>
          Effect.sync(() => {
            subscription.unsubscribe();
          })
      );
    });

    return {
      actor,
      column,
      dispatch,
      root,
      setTargets: (next: readonly (typeof GestureTarget.Type)[]) => {
        targets = next;
      },
    };
  }
);

it.effect(
  "native drag-create selects a snapped range and opens the normal editor without writing",
  () =>
    Effect.gen(function* nativeCreate() {
      const h = yield* harness(false);
      yield* h.dispatch("pointerdown", 543, h.column);
      yield* h.dispatch("pointermove", 608);

      const snapshot = yield* h.dispatch("pointerup", 608);
      const result = yield* Effect.fromNullishOr(snapshot.context.completed);

      expect(result.range).toMatchObject({
        endTime: "10:15",
        startTime: "09:00",
      });

      const update = completeGesture(fixtureSelection(), result);

      const command = yield* Schema.decodeUnknownEffect(EditingCommand)(
        update.commands?.[0]?.args?.command
      );

      expect(update.commands?.[0]?.name).toBe("DispatchEditing");
      expect(EditingCommand.guards.Open(command)).toBe(true);

      if (EditingCommand.guards.Open(command)) {
        expect(EditorRequest.guards.New(command.request)).toBe(true);
        expect(command.request).toMatchObject({
          endTime: "10:15",
          startTime: "09:00",
        });
      }
    })
);

it.effect(
  "native drag-create hits the visible day after horizontal scrolling behind four fixed gutters",
  () =>
    Effect.gen(function* scrolledCreate() {
      const h = yield* harness(false);

      const viewport = yield* Effect.fromNullishOr(
        h.root.querySelector<HTMLElement>("#time-viewport")
      );

      viewport.scrollLeft = 120;
      viewport.getBoundingClientRect = () => new DOMRect(185, 0, 455, 700);

      for (let index = 1; index < 7; index += 1) {
        const column = document.createElement("div");
        column.className = "day-column";
        column.dataset.day = String(day + index);
        viewport.append(column);
      }

      const columns = [
        ...viewport.querySelectorAll<HTMLElement>(".day-column"),
      ];

      for (const [index, column] of columns.entries()) {
        column.getBoundingClientRect = () =>
          new DOMRect(
            185 + 4 * 46 + index * 59 - viewport.scrollLeft,
            53,
            59,
            1440
          );
      }

      const chosen = yield* Effect.fromNullishOr(columns[3]);
      yield* h.dispatch("pointerdown", 596, chosen, undefined, 456);
      yield* h.dispatch("pointermove", 661, window, undefined, 456);

      const snapshot = yield* h.dispatch(
        "pointerup",
        661,
        window,
        undefined,
        456
      );

      const result = yield* Effect.fromNullishOr(snapshot.context.completed);
      expect(result.range).toMatchObject({
        endDate: "2026-10-22",
        endTime: "10:15",
        startDate: "2026-10-22",
        startTime: "09:00",
      });
    })
);

it.effect.each(["updated", "deleted", "permission"])(
  "live target %s during a drag preserves the actor and rebases or refuses the drop",
  (kind) =>
    Effect.gen(function* liveTargetDrop() {
      const h = yield* harness(true);
      yield* h.dispatch(
        "pointerdown",
        540,
        h.root.querySelector(".event-chip") ?? h.column
      );
      yield* h.dispatch("pointermove", 600);

      const current: CalendarEventValue =
        kind === "permission"
          ? {
              ...editorOriginal,
              guestsCanModify: false,
              organizer: { ...editorOriginal.organizer, self: false },
            }
          : { ...editorOriginal, title: "Updated while dragging" };

      h.setTargets(
        kind === "deleted"
          ? []
          : [{ ...target, editable: kind !== "permission", event: current }]
      );
      expect(h.actor.getSnapshot().matches("dragging")).toBe(true);
      const snapshot = yield* h.dispatch("pointerup", 660);
      const result = yield* Effect.fromNullishOr(snapshot.context.completed);

      const updated = completeGesture(
        currentGestureModel(kind === "deleted" ? null : current),
        result
      );

      if (kind === "updated") {
        const command = yield* Schema.decodeUnknownEffect(EditingCommand)(
          updated.commands?.[0]?.args?.command
        );

        expect(EditingCommand.guards.Open(command)).toBe(true);

        if (
          EditingCommand.guards.Open(command) &&
          EditorRequest.guards.Existing(command.request)
        ) {
          expect(command.request.event.title).toBe("Updated while dragging");
          expect(command.request.range).toMatchObject({
            endTime: "12:00",
            startTime: "11:00",
          });
        }
      } else {
        expect(updated.commands).toBeUndefined();
        expect(Option.getOrUndefined(updated.model.error)).toMatch(
          kind === "deleted" ? /no longer available/iu : /permission/iu
        );
      }
    })
);

it.effect.each(["move", "resize", "duplicate"])(
  "native %s uses the normal existing-event write plan",
  (kind) =>
    Effect.gen(function* nativeExisting() {
      const h = yield* harness(true);

      const element = yield* Effect.fromNullishOr(
        h.root.querySelector<HTMLElement>(
          kind === "resize" ? "[data-resize-edge]" : ".event-chip"
        )
      );

      const duplicate = kind === "duplicate";
      yield* h.dispatch(
        "pointerdown",
        kind === "resize" ? 600 : 540,
        element,
        duplicate
      );
      yield* h.dispatch("pointermove", 660, window, duplicate);

      const snapshot = yield* h.dispatch("pointerup", 660, window, duplicate);
      const result = yield* Effect.fromNullishOr(snapshot.context.completed);

      const update = completeGesture(
        currentGestureModel(editorOriginal),
        result
      );

      const command = yield* Schema.decodeUnknownEffect(EditingCommand)(
        update.commands?.[0]?.args?.command
      );

      expect(EditingCommand.guards.Open(command)).toBe(true);

      if (EditingCommand.guards.Open(command)) {
        expect(EditorRequest.guards.Existing(command.request)).toBe(true);
        expect(command.request).toMatchObject({
          mode: duplicate ? "duplicate" : "edit",
          range: {
            endTime: kind === "resize" ? "11:00" : "12:00",
            startTime: kind === "resize" ? "09:00" : "11:00",
          },
        });
      }

      expect(Option.isSome(result.target)).toBe(true);
    })
);
