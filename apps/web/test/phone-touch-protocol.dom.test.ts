import { expect, it } from "@effect/vitest";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";

import { timeGridGeometry } from "../src/client/time-blocks/grid.js";
import { minuteToY } from "../src/layout/geometry.js";
import { mountPhoneGrid, phonePointer } from "./phone-grid-native-fixture.js";
import { phoneTouchFixture } from "./phone-touch-fixture.js";
import { observePhoneActors } from "./phone-touch-observation.js";

const protocol = Effect.fn("phoneTouch.protocol")(function* protocol(
  kind: "move" | "create"
) {
  const observation = yield* observePhoneActors();
  const clock = yield* Clock.Clock;

  const initial = phoneTouchFixture({
    height: 844,
    kind,
    state: "pressed",
    theme: "light",
    width: 390,
  });

  const scene = yield* mountPhoneGrid(clock, initial, observation.watcher);

  return { observation, scene };
});

type Protocol = Effect.Success<ReturnType<typeof protocol>>;

const held = Effect.fn("phoneTouch.held")(function* held(
  harness: Protocol,
  target: HTMLElement,
  y: number
) {
  const before = harness.observation.cursor();
  phonePointer(target, "pointerdown", 180, y);
  yield* harness.observation.next(
    "calendar.gesture",
    before,
    (snapshot) => snapshot.value === "pressed"
  );
  yield* TestClock.adjust(450);

  return yield* harness.observation.next(
    "calendar.gesture",
    before,
    (snapshot) => snapshot.value === "dragging"
  );
});

it.effect(
  "the mounted observation port exposes the existing root actors without changing their initial state",
  () =>
    Effect.gen(function* observeMountedActors() {
      const { observation } = yield* protocol("create");
      const gesture = yield* observation.read("calendar.gesture");
      const touch = yield* observation.read("calendar.phoneTouch");
      expect(gesture.value).toBe("idle");
      expect(gesture.context.sequence).toBe(0);
      expect(touch.value).toBe("idle");
      expect(touch.context.blockClick).toBe(false);
    }).pipe(Effect.scoped)
);

it.effect(
  "mounted held completion consumes its compatibility click once and preserves the next keyboard-style activation click",
  () =>
    Effect.gen(function* compatibilityClickAcknowledgement() {
      const harness = yield* protocol("create");
      const { observation, scene } = harness;
      yield* held(harness, scene.column, 200);
      phonePointer(window, "pointermove", 180, 260);
      const release = observation.cursor();
      phonePointer(window, "pointerup", 180, 260);
      yield* observation.next(
        "calendar.gesture",
        release,
        (snapshot) =>
          snapshot.value === "idle" && snapshot.context.sequence === 1
      );
      yield* scene.notice("CompletedGesture");
      expect(scene.commands).toContain("DispatchEditing");
      const clickCursor = observation.cursor();

      const compatibility = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        detail: 1,
      });

      scene.root.dispatchEvent(compatibility);
      expect(compatibility.defaultPrevented).toBe(true);
      yield* observation.next(
        "calendar.phoneTouch",
        clickCursor,
        (snapshot) => snapshot.value === "idle" && !snapshot.context.blockClick
      );

      const chip = yield* Effect.fromNullishOr(
        scene.root.querySelector<HTMLButtonElement>(".event-chip")
      );

      chip.focus();

      const keyboard = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        detail: 0,
      });

      chip.dispatchEvent(keyboard);
      expect(keyboard.defaultPrevented).toBe(false);
      yield* scene.notice("ClickedEvent");
      expect(scene.read().calendar.selected).toEqual([chip.dataset.eventKey]);
      expect(scene.read().phoneShell.mode).toBe("details");
    }).pipe(Effect.scoped)
);

it.effect.each(["move", "create"] as const)(
  "mounted held %s cancels a changed phone period on release even when lost capture arrives later",
  (kind) =>
    Effect.gen(function* staleHeldRelease() {
      const harness = yield* protocol(kind);
      const { observation, scene } = harness;
      yield* held(harness, kind === "move" ? scene.chip : scene.column, 200);
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const descriptor = Object.getOwnPropertyDescriptor(
            scene.root,
            "releasePointerCapture"
          );

          Object.defineProperty(scene.root, "releasePointerCapture", {
            configurable: true,
            value: (id: number) => {
              scene.captures.delete(id);
            },
            writable: true,
          });

          return descriptor;
        }),
        (descriptor) =>
          Effect.sync(() => {
            if (descriptor === undefined) {
              Reflect.deleteProperty(scene.root, "releasePointerCapture");
            } else {
              Object.defineProperty(
                scene.root,
                "releasePointerCapture",
                descriptor
              );
            }
          })
      );
      const original = scene.root.dataset.phonePeriod;
      scene.root.dataset.phonePeriod = "expired-phone-period";
      expect(scene.root.dataset.phonePeriod).not.toBe(original);
      expect(scene.root.isConnected).toBe(true);
      const release = observation.cursor();
      phonePointer(window, "pointerup", 180, 260);

      const ended = yield* observation.next(
        "calendar.gesture",
        release,
        (snapshot) => snapshot.value === "idle"
      );

      expect(ended.context.sequence).toBe(0);
      expect(ended.context.completed).toBeUndefined();
      expect(scene.commands).not.toContain("DispatchEditing");
      expect(scene.captures.size).toBe(0);
      scene.root.dispatchEvent(
        new PointerEvent("lostpointercapture", {
          pointerId: 1,
          pointerType: "touch",
        })
      );
    }).pipe(Effect.scoped)
);

it.effect(
  "mounted touch resize keeps the original edge on hold and applies motion from the press point",
  () =>
    Effect.gen(function* relativeTouchResize() {
      const harness = yield* protocol("move");
      const { observation, scene } = harness;

      const handle = yield* Effect.fromNullishOr(
        scene.root.querySelector<HTMLElement>(
          '.event-chip.selected [data-touch-resize-edge="end"]'
        )
      );

      const { grid } = timeGridGeometry(scene.read());
      const contact = minuteToY(grid, 589);
      handle.getBoundingClientRect = () =>
        new DOMRect(158, contact - 22, 44, 44);
      const activated = yield* held(harness, scene.chip, contact);
      expect(activated.context.preview?.range).toMatchObject({
        endTime: "10:00",
        startTime: "09:00",
      });
      const motion = observation.cursor();
      phonePointer(window, "pointermove", 180, minuteToY(grid, 619));

      const moved = yield* observation.next(
        "calendar.gesture",
        motion,
        (snapshot) => snapshot.value === "dragging"
      );

      expect(moved.context.preview?.range).toMatchObject({
        endTime: "10:30",
        startTime: "09:00",
      });
    }).pipe(Effect.scoped)
);

it.effect.each(["mouse", "pen"] as const)(
  "fine resize stays eager and absolute on a coarse phone: %s",
  (pointerType) =>
    Effect.gen(function* fineResize() {
      const { observation, scene } = yield* protocol("move");

      const handle = yield* Effect.fromNullishOr(
        scene.root.querySelector<HTMLElement>(
          '.event-chip.selected [data-resize-edge="end"]'
        )
      );

      const { grid } = timeGridGeometry(scene.read());
      const before = observation.cursor();
      phonePointer(
        handle,
        "pointerdown",
        180,
        minuteToY(grid, 589),
        pointerType
      );
      yield* observation.next(
        "calendar.gesture",
        before,
        (snapshot) => snapshot.value === "armed"
      );
      expect(scene.captures.has(1)).toBe(true);
      const motion = observation.cursor();
      phonePointer(
        window,
        "pointermove",
        180,
        minuteToY(grid, 619),
        pointerType
      );

      const moved = yield* observation.next(
        "calendar.gesture",
        motion,
        (snapshot) => snapshot.value === "dragging"
      );

      expect(moved.context.preview?.range).toMatchObject({
        endTime: "10:15",
        startTime: "09:00",
      });
      phonePointer(
        window,
        "pointercancel",
        180,
        minuteToY(grid, 619),
        pointerType
      );

      if (scene.captures.has(1)) {
        scene.root.releasePointerCapture(1);
      }
    }).pipe(Effect.scoped)
);
