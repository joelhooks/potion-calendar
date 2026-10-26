import { setupEffect } from "@xstate/effect";
import { Schema } from "effect";
import { transition } from "xstate";

export const nativeNotificationMachine = setupEffect({
  schemas: {
    events: {
      ACT: Schema.Struct({}),
      CLOSE: Schema.Struct({}),
      FAIL: Schema.Struct({}),
      SHOW: Schema.Struct({}),
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
    active: { on: { ACT: { target: "acting" } } },
    failed: { type: "final" },
    retired: { type: "final" },
    showing: { on: { ACT: { target: "acting" }, SHOW: { target: "active" } } },
  },
});

export type NativeNotificationPhase =
  | "showing"
  | "active"
  | "acting"
  | "retired"
  | "failed";

export const notificationPhase = (
  value: NativeNotificationPhase,
  type: "ACT" | "CLOSE" | "FAIL" | "SHOW"
): NativeNotificationPhase => {
  const [next] = transition(
    nativeNotificationMachine,
    nativeNotificationMachine.resolveState({ value }),
    { type }
  );

  return Schema.decodeSync(
    Schema.Literals(["showing", "active", "acting", "retired", "failed"])
  )(next.value);
};
