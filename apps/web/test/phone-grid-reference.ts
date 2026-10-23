import { Schema } from "effect";

export const PhoneTouchStep = Schema.Struct({
  enabled: Schema.Boolean,
  kind: Schema.Literals(["down", "move", "up", "cancel", "click", "hold"]),
  pointerId: Schema.Literals([1, 2]),
  x: Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: -100 })),
  y: Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: -100 })),
});

type Command = typeof PhoneTouchStep.Type;

interface Reference {
  readonly phase: "idle" | "pending" | "scrolling" | "swiping" | "held";
  readonly origin: Command | undefined;
  readonly sequence: number;
  readonly block: boolean;
  readonly direction: -1 | 1 | undefined;
}

export const initialPhoneReference = (): Reference => ({
  block: false,
  direction: undefined,
  origin: undefined,
  phase: "idle",
  sequence: 0,
});

const referenceDown = (current: Reference, step: Command): Reference => {
  if (current.phase === "idle") {
    return { ...current, block: false, origin: step, phase: "pending" };
  }

  return current.phase === "pending"
    ? { ...current, block: true, origin: undefined, phase: "idle" }
    : current;
};

const referenceMove = (current: Reference, step: Command): Reference => {
  const { origin } = current;

  if (
    current.phase !== "pending" ||
    origin === undefined ||
    origin.pointerId !== step.pointerId
  ) {
    return current;
  }

  const x = Math.abs(step.x - origin.x);
  const y = Math.abs(step.y - origin.y);

  if (x < 48 && y < 48) {
    return current;
  }

  return {
    ...current,
    block: true,
    phase: origin.enabled && y < x ? "swiping" : "scrolling",
  };
};

const referenceUp = (current: Reference, step: Command): Reference => {
  const { origin } = current;

  if (
    current.phase === "idle" ||
    origin === undefined ||
    origin.pointerId !== step.pointerId
  ) {
    return current;
  }

  const x = Math.abs(step.x - origin.x);
  const y = Math.abs(step.y - origin.y);

  const canNavigate =
    (current.phase === "pending" || current.phase === "swiping") &&
    origin.enabled &&
    x >= 48 &&
    y < x;

  const released = {
    ...current,
    block:
      current.block || (current.phase === "pending" && (x >= 48 || y >= 48)),
    origin: undefined,
    phase: "idle" as const,
  };

  if (!canNavigate) {
    return released;
  }

  return {
    ...released,
    direction: step.x < origin.x ? 1 : -1,
    sequence: current.sequence + 1,
  };
};

export const nextPhoneReference = (
  current: Reference,
  step: Command
): Reference => {
  switch (step.kind) {
    case "down": {
      return referenceDown(current, step);
    }

    case "move": {
      return referenceMove(current, step);
    }

    case "up": {
      return referenceUp(current, step);
    }

    case "cancel": {
      return {
        ...current,
        block: current.block || current.origin !== undefined,
        origin: undefined,
        phase: "idle",
      };
    }

    case "click": {
      return current.phase === "idle" ? { ...current, block: false } : current;
    }

    case "hold": {
      return current.phase === "pending" &&
        current.origin?.pointerId === step.pointerId
        ? { ...current, block: true, phase: "held" }
        : current;
    }

    default: {
      return step.kind satisfies never;
    }
  }
};
