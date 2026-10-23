import { expect, it } from "@effect/vitest";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";

import { phoneGridFixture, phoneGridScenes } from "./phone-grid-fixture.js";
import {
  mountPhoneGrid,
  phoneDom,
  phonePointer,
} from "./phone-grid-native-fixture.js";
import { phoneTouchFixture } from "./phone-touch-fixture.js";

const nativeMoveStandIn = (target: EventTarget, cancelable = true) => {
  const event = new TouchEvent("touchmove", { bubbles: true, cancelable });
  Object.defineProperty(event, "touches", { value: { length: 1 } });
  target.dispatchEvent(event);

  return event;
};

it.effect.each(["move", "create", "unselected"] as const)(
  "real touch listeners wait for hold, survive implicit capture transfer and dispatch the existing editor opening: %s",
  (kind) =>
    Effect.gen(function* heldRecipient() {
      const clock = yield* Clock.Clock;

      const initial = phoneTouchFixture({
        height: 844,
        kind: kind === "create" ? "create" : "move",
        state: "pressed",
        theme: "light",
        width: 390,
      });

      const scene = yield* mountPhoneGrid(
        clock,
        kind === "unselected"
          ? {
              ...initial,
              calendar: { ...initial.calendar, selected: [] },
            }
          : initial
      );

      const target = kind === "create" ? scene.column : scene.chip;
      const { navigation } = scene.read().calendar;
      expect(
        phonePointer(target, "pointerdown", 180, 200).defaultPrevented
      ).toBe(false);
      yield* phoneDom(() => scene.root.dataset.touchEditPhase === "pressed");
      yield* TestClock.adjust(449);
      expect(scene.root.dataset.touchPhase).toBe("pending");
      expect(scene.captures.size).toBe(0);
      expect(scene.commands).not.toContain("DispatchEditing");
      expect(nativeMoveStandIn(target).defaultPrevented).toBe(false);

      const beforeContext = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
      });

      target.dispatchEvent(beforeContext);
      expect(beforeContext.defaultPrevented).toBe(false);
      yield* TestClock.adjust(1);
      yield* phoneDom(
        () =>
          scene.root.dataset.touchEditPhase === "active" ||
          scene.root.dataset.touchEditPhase === "idle"
      );
      expect(scene.root.dataset.touchEditPhase).toBe("active");
      expect(scene.root.dataset.touchPhase).toBe("held");
      expect(scene.captures.has(1)).toBe(true);
      expect(scene.transfers).toEqual([1]);
      expect(nativeMoveStandIn(target).defaultPrevented).toBe(true);
      expect(nativeMoveStandIn(target, false).defaultPrevented).toBe(false);

      const heldContext = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
      });

      target.dispatchEvent(heldContext);
      expect(heldContext.defaultPrevented).toBe(true);
      phonePointer(window, "pointermove", 180, 260);
      yield* scene.notice("PreviewedGesture");
      phonePointer(window, "pointerup", 180, 260);
      yield* scene.notice("CompletedGesture");
      expect(scene.commands).toContain("DispatchEditing");
      expect(scene.read().calendar.navigation).toEqual(navigation);
      expect(scene.captures.size).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect.each([
  "boundary",
  "diagonal",
  "up",
  "pointercancel",
  "blur",
  "pagehide",
  "escape",
  "second-finger",
] as const)(
  "touch hold cancellation leaves native scrolling unlocked and never dispatches editing: %s",
  (reason) =>
    Effect.gen(function* cancelledHold() {
      const clock = yield* Clock.Clock;
      const scene = yield* mountPhoneGrid(clock);
      phonePointer(scene.chip, "pointerdown", 180, 200);
      yield* phoneDom(() => scene.root.dataset.touchEditPhase === "pressed");

      if (reason === "boundary") {
        phonePointer(window, "pointermove", 188, 200);
      } else if (reason === "diagonal") {
        phonePointer(window, "pointermove", 186, 206);
      } else if (reason === "up") {
        phonePointer(window, "pointerup", 180, 200);
      } else if (reason === "pointercancel") {
        phonePointer(window, "pointercancel", 180, 200);
      } else if (reason === "escape") {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Escape",
          })
        );
      } else if (reason === "second-finger") {
        phonePointer(scene.column, "pointerdown", 190, 210, "touch", 2, false);
      } else {
        window.dispatchEvent(new Event(reason));
      }

      yield* phoneDom(() => scene.root.dataset.touchEditPhase === "idle");
      yield* TestClock.adjust(1000);
      expect(scene.root.dataset.gesturePhase).toBe("idle");
      expect(scene.commands).not.toContain("DispatchEditing");
      expect(scene.captures.size).toBe(0);
      expect(nativeMoveStandIn(scene.column).defaultPrevented).toBe(false);
      phonePointer(window, "pointerup", 180, 200);
    }).pipe(Effect.scoped)
);

it.effect(
  "fractional touch input rounds only the displayed press cue to whole pixels",
  () =>
    Effect.gen(function* fractionalPressCue() {
      const clock = yield* Clock.Clock;
      const scene = yield* mountPhoneGrid(clock);
      phonePointer(scene.chip, "pointerdown", 180.25, 200.75);
      yield* phoneDom(() => scene.root.dataset.touchEditPhase === "pressed");
      expect(scene.root.style.getPropertyValue("--touch-press-x")).toBe(
        "180px"
      );
      expect(scene.root.style.getPropertyValue("--touch-press-y")).toBe(
        "201px"
      );
      expect(scene.captures.size).toBe(0);
      expect(scene.commands).not.toContain("DispatchEditing");
      phonePointer(window, "pointerup", 180.25, 200.75);
      yield* phoneDom(() => scene.root.dataset.touchEditPhase === "idle");
    }).pipe(Effect.scoped)
);

it.effect(
  "a read-only hold is refused through the existing recipient without capture or native scroll lock",
  () =>
    Effect.gen(function* readOnlyHold() {
      const clock = yield* Clock.Clock;
      const base = phoneGridFixture(phoneGridScenes[0]);

      const scene = yield* mountPhoneGrid(clock, {
        ...base,
        calendar: {
          ...base.calendar,
          calendars: base.calendar.calendars.map((calendar) => ({
            ...calendar,
            accessRole: "reader",
          })),
        },
      });

      phonePointer(scene.chip, "pointerdown", 180, 200);
      yield* phoneDom(() => scene.root.dataset.touchEditPhase === "pressed");
      yield* TestClock.adjust(450);
      yield* scene.notice("RefusedGesture");
      expect(scene.commands).not.toContain("DispatchEditing");
      expect(scene.root.dataset.touchPhase).toBe("pending");
      expect(scene.captures.size).toBe(0);
      expect(nativeMoveStandIn(scene.column).defaultPrevented).toBe(false);
      phonePointer(window, "pointerup", 180, 200);
    }).pipe(Effect.scoped)
);
