import { setupEffect } from "@xstate/effect";
import { Schema } from "effect";
import { initialTransition, transition, types } from "xstate";

import { PhoneShellMode } from "./model.js";

interface ShellContext {
  readonly mode: typeof PhoneShellMode.Type;
}

export const phoneShellMachine = setupEffect({
  schemas: {
    context: types<ShellContext>(),
    events: {
      CLOSE: Schema.Struct({}),
      OPEN: Schema.Struct({ mode: PhoneShellMode }),
    },
    input: Schema.Struct({ mode: PhoneShellMode }),
  },
}).createMachine({
  context: ({ input }) => input,
  initial: "restore",
  on: {
    CLOSE: { context: { mode: "closed" }, target: ".closed" },
    OPEN: ({ event }) => ({
      context: { mode: event.mode },
      target: `.${event.mode}`,
    }),
  },
  states: {
    closed: {},
    details: {},
    drawer: {},
    restore: {
      always: ({ context }) => ({ target: context.mode }),
    },
    upcoming: {},
  },
});

export const phoneShellMode = (
  mode: typeof PhoneShellMode.Type,
  next: typeof PhoneShellMode.Type
): typeof PhoneShellMode.Type => {
  const [snapshot] = initialTransition(phoneShellMachine, { mode });

  return transition(phoneShellMachine, snapshot, {
    mode: next,
    type: "OPEN",
  })[0].context.mode;
};
