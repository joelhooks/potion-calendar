import { Effect, Option, Predicate, Queue, Schema, Stream } from "effect";
import { Mount } from "foldkit";
import { renderToString } from "foldkit/experimental/server";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppMessage, AppModel } from "../src/client/app.js";
import { gestureMountFor } from "../src/client/editing/gesture-mount.js";
import {
  gestureTargetRegistry,
  modelGestureHostKey,
  modelGestureInputs,
} from "../src/client/editing/gesture-targets.js";
import { EditingCommand } from "../src/client/editing/runtime.js";
import { PrepareSelection } from "../src/client/selection/mount.js";
import { timeGridGeometry } from "../src/client/time-blocks/grid.js";
import { TimeZoneAction } from "../src/client/time-zones/model.js";
import { view } from "../src/features/app.js";
import { minuteToY } from "../src/layout/geometry.js";
import { visibleDays } from "../src/layout/navigation.js";
import { timeBlockModel } from "./time-block-fixture.js";

export const fulldayScenes = [
  "timed",
  "all-day",
  "month",
  "multi-day",
  "travel",
  "plain",
  "alt",
  "refused",
] as const;

export type FulldayScene = (typeof fulldayScenes)[number];

export const fulldayModel = (
  scene: FulldayScene,
  width = 1440,
  theme: "light" | "dark" = "light"
): AppModel => {
  const base = timeBlockModel(
    scene === "multi-day" ? "14-day" : "week",
    width,
    theme
  );

  let model: AppModel = {
    ...base,
    calendar: {
      ...base.calendar,
      calendars:
        scene === "refused"
          ? base.calendar.calendars.map((calendar) => ({
              ...calendar,
              accessRole: "reader",
            }))
          : base.calendar.calendars,
      navigation: {
        ...base.calendar.navigation,
        hideWeekends: scene === "multi-day",
        mode: scene === "month" ? "month" : base.calendar.navigation.mode,
      },
      viewportWidth: Math.max(200, width - (width <= 600 ? 0 : 240)),
    },
    phoneShell: { ...base.phoneShell, viewportWidth: width },
    settings: { ...base.settings, timeBlocks: { blocks: [], enabled: false } },
  };

  if (scene === "travel") {
    ({ model } = update(
      model,
      Message.TimeZoneAction({
        action: TimeZoneAction.cases.Travel.make({
          zone: { id: "Pacific/Auckland", label: "Auckland" },
        }),
      })
    ));
  }

  return model;
};

const take = Effect.fn("test.takeFulldayMessage")(function* take(
  queue: Queue.Queue<AppMessage>,
  matches: (message: AppMessage) => boolean
) {
  while (true) {
    const message = yield* Queue.take(queue);

    if (matches(message)) {
      return message;
    }
  }
});

export const mountedFullday = Effect.fn("test.mountedFullday")(
  function* mountedFullday(initial: AppModel, platform: string) {
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        vi.spyOn(navigator, "platform", "get").mockReturnValue(platform)
      ),
      (mock) =>
        Effect.sync(() => {
          mock.mockRestore();
        })
    );
    let current = initial;
    const commands: (typeof EditingCommand.Type)[] = [];
    const messages: AppMessage[] = [];
    const queue = yield* Queue.unbounded<AppMessage>();

    const html = yield* renderToString(
      { init: () => ({ model: initial }), view },
      { isHydratable: false }
    );

    const container = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const element = document.createElement("div");
        element.innerHTML = html.html;
        document.body.append(element);

        return element;
      }),
      (element) =>
        Effect.sync(() => {
          element.remove();
        })
    );

    const root = yield* Effect.fromNullishOr(
      container.querySelector<HTMLElement>(".month-view,.time-view")
    );

    const month = root.classList.contains("month-view");
    const days = visibleDays(initial.calendar.navigation);

    const cells = [
      ...root.querySelectorAll<HTMLElement>(
        month ? ".month-cell[data-day]" : ".day-column[data-day]"
      ),
    ].filter((cell) => cell.closest("[data-month-parked]") === null);

    const { grid, scale } = timeGridGeometry(initial);

    for (const [index, cell] of cells.entries()) {
      cell.getBoundingClientRect = () =>
        month
          ? new DOMRect(
              100 + (index % 7) * 100,
              100 + Math.floor(index / 7) * 180,
              100,
              180
            )
          : new DOMRect(100 + index * 100, 100, 100, grid.height);
    }

    for (const cell of root.querySelectorAll<HTMLElement>(
      ".all-day-cell[data-day]"
    )) {
      const index = days.indexOf(Number(cell.dataset.day));
      cell.getBoundingClientRect = () =>
        new DOMRect(100 + index * 100, 50, 100, 40);
    }

    const registry = gestureTargetRegistry();
    const key = Option.getOrThrow(modelGestureHostKey(initial));
    const personId = Option.getOrThrow(initial.person);
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        registry.register(key, root, () => modelGestureInputs(current).targets)
      ),
      (release) => Effect.sync(release)
    );

    const consume = Effect.fn("test.consumeFulldayMessage")(function* consume(
      message: AppMessage
    ) {
      messages.push(message);
      const result = update(current, message);
      current = result.model;

      for (const command of result.commands ?? []) {
        if (command.name === "DispatchEditing") {
          commands.push(
            yield* Schema.decodeUnknownEffect(EditingCommand)(
              command.args?.command
            )
          );
        }
      }

      Queue.offerUnsafe(queue, message);
    });

    const scope = yield* Effect.scope;
    yield* PrepareSelection({ hostKey: key, personId })
      .f(container, Mount.liveViewStateChanges)
      .pipe(Stream.runForEach(consume), Effect.forkIn(scope));
    yield* take(queue, (message) =>
      Predicate.isTagged(message, "PreparedSelection")
    );
    yield* gestureMountFor(registry)({
      hidden: grid.hidden,
      hostKey: key,
      personId,
      scale,
    })
      .f(root, Mount.liveViewStateChanges)
      .pipe(Stream.runForEach(consume), Effect.forkIn(scope));
    yield* take(queue, (message) =>
      Predicate.isTagged(message, "PreparedGestureHost")
    );

    const pointer = Effect.fn("test.fulldayPointer")(function* pointer(
      type: "pointerdown" | "pointerup",
      cell: HTMLElement,
      at: number,
      minute: number,
      modifiers: {
        readonly alt?: boolean;
        readonly mod?: boolean;
        readonly shift?: boolean;
      } = {}
    ) {
      const rect = cell.getBoundingClientRect();

      const event = new PointerEvent(type, {
        altKey: modifiers.alt === true,
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY:
          month || cell.classList.contains("all-day-cell")
            ? rect.top + 10
            : rect.top + minuteToY(grid, minute),
        ctrlKey: modifiers.mod === true && platform !== "MacIntel",
        isPrimary: true,
        metaKey: modifiers.mod === true && platform === "MacIntel",
        pointerId: 72,
        pointerType: "mouse",
        shiftKey: modifiers.shift === true,
      });

      Object.defineProperty(event, "timeStamp", { value: at });
      (type === "pointerdown" ? cell : window).dispatchEvent(event);
      yield* take(
        queue,
        (message) =>
          Predicate.isTagged(message, "PreviewedGesture") &&
          message.phase === (type === "pointerdown" ? "armed" : "idle")
      );
    });

    const click = Effect.fn("test.fulldayClick")(function* click(
      cell: HTMLElement,
      at: number,
      minute: number,
      modifiers: { readonly alt?: boolean; readonly mod?: boolean } = {}
    ) {
      yield* pointer("pointerdown", cell, at, minute, modifiers);
      yield* pointer("pointerup", cell, at + 1, minute, modifiers);
      cell.dispatchEvent(
        new MouseEvent("click", {
          altKey: modifiers.alt === true,
          bubbles: true,
          cancelable: true,
          ctrlKey: modifiers.mod === true && platform !== "MacIntel",
          metaKey: modifiers.mod === true && platform === "MacIntel",
        })
      );
      yield* Effect.yieldNow;
    });

    return {
      cells,
      click,
      commands,
      container,
      get: () => current,
      grid,
      messages,
      next: (matches: (message: AppMessage) => boolean) => take(queue, matches),
      pointer,
      root,
    };
  }
);
