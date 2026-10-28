import { setupEffect } from "@xstate/effect";
import { Schema } from "effect";
import { transition } from "xstate";

export const nativeNotificationMachine = setupEffect({
  schemas: {
    events: {
      ACT: Schema.Struct({}),
      CLOSE: Schema.Struct({}),
      FAIL: Schema.Struct({}),
      RESUME: Schema.Struct({}),
      SHOW: Schema.Struct({}),
      SNOOZE: Schema.Struct({}),
    },
  },
}).createMachine({
  initial: "showing",
  on: {
    CLOSE: { target: ".retired" },
    FAIL: { target: ".failed" },
  },
  states: {
    acting: {},
    active: {
      on: { ACT: { target: "acting" }, SNOOZE: { target: "snoozing" } },
    },
    failed: { type: "final" },
    retired: { type: "final" },
    showing: {
      on: {
        ACT: { target: "acting" },
        SHOW: { target: "active" },
        SNOOZE: { target: "snoozing" },
      },
    },
    snoozing: { on: { RESUME: { target: "active" } } },
  },
});

export type NativeNotificationPhase =
  | "showing"
  | "active"
  | "acting"
  | "snoozing"
  | "retired"
  | "failed";

export const notificationPhase = (
  value: NativeNotificationPhase,
  type: "ACT" | "CLOSE" | "FAIL" | "SHOW" | "SNOOZE" | "RESUME"
): NativeNotificationPhase => {
  const [next] = transition(
    nativeNotificationMachine,
    nativeNotificationMachine.resolveState({ value }),
    { type }
  );

  return Schema.decodeSync(
    Schema.Literals([
      "showing",
      "active",
      "acting",
      "snoozing",
      "retired",
      "failed",
    ])
  )(next.value);
};
