import type { EffectActor } from "@xstate/effect";
import { Option, Schema } from "effect";

import type { MonthGestureRefused } from "../month/gesture.js";
import type { phoneTouchMachine } from "../phone-grid/machine.js";
import type { gestureMachine } from "./gesture-machine.js";
import { GestureTarget } from "./gesture-model.js";
import type { GestureStart } from "./gesture-model.js";

type GestureSnapshot = ReturnType<
  EffectActor<typeof gestureMachine>["getSnapshot"]
>;

type TouchActor = EffectActor<typeof phoneTouchMachine>;

type Targets = readonly (typeof GestureTarget.Type)[];

interface Input {
  readonly actor: EffectActor<typeof gestureMachine>;
  readonly getTargets: () => Targets | undefined;
  readonly phoneTouch: TouchActor | undefined;
  readonly refused:
    | ((reason: MonthGestureRefused["reason"]) => void)
    | undefined;
  readonly root: HTMLElement;
}

const sameTarget = Schema.toEquivalence(GestureTarget);

export const supportsTouchHold = (
  root: HTMLElement,
  phoneTouch: TouchActor | undefined
): boolean =>
  phoneTouch !== undefined &&
  root.dataset.phonePeriod !== undefined &&
  root.ownerDocument.defaultView?.matchMedia?.("(any-pointer: coarse)")
    .matches === true;

const phaseFor = (snapshot: GestureSnapshot, held: boolean) => {
  if (snapshot.matches("pressed")) {
    return "pressed";
  }

  if (snapshot.matches("ready")) {
    return "ready";
  }

  return held && snapshot.matches("dragging") ? "active" : "idle";
};

const ownsPendingPointer = (
  phoneTouch: TouchActor | undefined,
  root: HTMLElement,
  start: typeof GestureStart.Type
): boolean => {
  const touch = phoneTouch?.getSnapshot();

  if (!root.isConnected || touch?.matches("pending") !== true) {
    return false;
  }

  const owner = touch.context.start;

  return (
    owner !== undefined &&
    owner.pointerId === start.point.pointerId &&
    owner.hostKey === root.dataset.phonePeriod
  );
};

const targetEligibility = (
  targets: Targets | undefined,
  start: typeof GestureStart.Type
) => {
  if (targets === undefined) {
    return "stale";
  }

  if (Option.isNone(start.target)) {
    return "ready";
  }

  const captured = start.target.value;
  const current = targets.find((target) => target.key === captured.key);

  if (current === undefined) {
    return "stale";
  }

  if (!current.editable) {
    return "refused";
  }

  return sameTarget(current, captured) ? "ready" : "stale";
};

export const bindGestureHold = ({
  actor,
  getTargets,
  phoneTouch,
  refused,
  root,
}: Input): (() => void) => {
  const touchSubscription = phoneTouch?.subscribe((snapshot) => {
    if (snapshot.matches("held") && actor.getSnapshot().matches("ready")) {
      actor.send({ type: "ACTIVATE" });
    }

    if (
      !snapshot.matches("pending") &&
      !snapshot.matches("held") &&
      (actor.getSnapshot().matches("pressed") ||
        actor.getSnapshot().matches("ready"))
    ) {
      actor.send({ type: "CANCEL" });
    }
  });

  const holdSubscription = actor.subscribe((snapshot) => {
    const phase = phaseFor(
      snapshot,
      phoneTouch?.getSnapshot().matches("held") === true
    );

    if (phase !== "idle" || root.dataset.touchEditPhase !== undefined) {
      root.dataset.touchEditPhase = phase;
    }

    if (!snapshot.matches("ready")) {
      return;
    }

    const { start } = snapshot.context;

    if (start === undefined || !ownsPendingPointer(phoneTouch, root, start)) {
      actor.send({ type: "CANCEL" });

      return;
    }

    const eligibility = targetEligibility(getTargets(), start);

    if (eligibility !== "ready") {
      if (eligibility === "refused") {
        refused?.("ReadOnlyEvent");
      }

      actor.send({ type: "CANCEL" });

      return;
    }

    phoneTouch?.send({ pointerId: start.point.pointerId, type: "HOLD" });
  });

  return () => {
    touchSubscription?.unsubscribe();
    holdSubscription.unsubscribe();
    Reflect.deleteProperty(root.dataset, "touchEditPhase");
    root.style.removeProperty("--touch-press-x");
    root.style.removeProperty("--touch-press-y");
  };
};
