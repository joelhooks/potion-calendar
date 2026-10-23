import { expect, it } from "@effect/vitest";
import { Clock, Effect, Option } from "effect";
import { TestClock } from "effect/testing";

import { Message } from "../src/client/app.js";
import {
  mountPhoneGrid,
  phoneDom,
  phonePointer,
} from "./phone-grid-native-fixture.js";
import { phoneTouchFixture } from "./phone-touch-fixture.js";

it.effect(
  "a host token change before hold cannot activate or capture the old source",
  () =>
    Effect.gen(function* changedHost() {
      const clock = yield* Clock.Clock;

      const scene = yield* mountPhoneGrid(
        clock,
        phoneTouchFixture({
          height: 844,
          kind: "move",
          state: "pressed",
          theme: "light",
          width: 390,
        })
      );

      phonePointer(scene.chip, "pointerdown", 180, 200);
      yield* phoneDom(() => scene.root.dataset.touchEditPhase === "pressed");
      const before = scene.read().calendar.navigation.anchor;
      scene.send(Message.ClickedPage({ direction: 1 }));
      yield* scene.notice("ClickedPage");
      yield* TestClock.adjust(450);
      yield* phoneDom(
        () =>
          !scene.root.isConnected ||
          scene.root.dataset.touchEditPhase === "idle" ||
          scene.root.dataset.touchEditPhase === undefined
      );
      expect(scene.read().calendar.navigation.anchor).toBe(before + 1);
      expect(scene.captures.size).toBe(0);
      expect(scene.commands).not.toContain("DispatchEditing");
      phonePointer(window, "pointerup", 180, 200);
    }).pipe(Effect.scoped)
);

it.effect(
  "disposing a mounted pending hold removes listeners and cancels its timer before stale delivery",
  () =>
    Effect.gen(function* disposedHold() {
      const clock = yield* Clock.Clock;

      const scene = yield* Effect.scoped(
        Effect.gen(function* pendingMount() {
          const mounted = yield* mountPhoneGrid(clock);
          phonePointer(mounted.column, "pointerdown", 180, 200);
          yield* phoneDom(
            () => mounted.root.dataset.touchEditPhase === "pressed"
          );

          return mounted;
        })
      );

      yield* TestClock.adjust(1000);
      expect(scene.root.isConnected).toBe(false);
      expect(scene.root.dataset.touchEditPhase).toBeUndefined();
      expect(scene.captures.size).toBe(0);
      expect(scene.commands).not.toContain("DispatchEditing");
      expect(document.querySelector("style[data-grid-touch-pan]")).toBeNull();
    })
);

it.effect(
  "a completed create hold with no writable calendar reaches the existing refusal and releases capture",
  () =>
    Effect.gen(function* noCreationCalendar() {
      const clock = yield* Clock.Clock;

      const initial = phoneTouchFixture({
        height: 932,
        kind: "create",
        state: "read-only",
        theme: "light",
        width: 430,
      });

      const scene = yield* mountPhoneGrid(clock, {
        ...initial,
        error: Option.none(),
      });

      phonePointer(scene.column, "pointerdown", 180, 200);
      yield* phoneDom(() => scene.root.dataset.touchEditPhase === "pressed");
      yield* TestClock.adjust(450);
      yield* phoneDom(() => scene.root.dataset.touchEditPhase === "active");
      phonePointer(window, "pointermove", 180, 260);
      phonePointer(window, "pointerup", 180, 260);
      yield* scene.notice("CompletedGesture");
      expect(Option.getOrThrow(scene.read().error)).toBe(
        "No writable calendar is available."
      );
      expect(scene.commands).not.toContain("DispatchEditing");
      expect(scene.captures.size).toBe(0);
    }).pipe(Effect.scoped)
);
