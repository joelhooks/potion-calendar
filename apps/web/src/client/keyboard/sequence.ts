import { setupEffect } from "@xstate/effect";
import { Schema } from "effect";
import { initialTransition, transition, types } from "xstate";

export const sequenceTimeout = 1000;

interface Sequence {
  readonly deadline: number;
  readonly prefix: string;
}

interface Context extends Sequence {
  readonly prefixes: readonly string[];
  readonly token: string;
}

export const sequenceMachine = setupEffect({
  schemas: {
    context: types<Context>(),
    events: { KEY: Schema.Struct({ key: Schema.String, now: Schema.Finite }) },
    input: Schema.Struct({
      deadline: Schema.Finite,
      prefix: Schema.String,
      prefixes: Schema.Array(Schema.String),
    }),
  },
}).createMachine({
  context: ({ input }) => ({ ...input, token: "" }),
  initial: "restore",
  states: {
    idle: {
      on: {
        KEY: ({ context, event }) =>
          context.prefixes.includes(event.key)
            ? {
                context: {
                  deadline: event.now + sequenceTimeout,
                  prefix: event.key,
                  token: "",
                },
                target: "pending",
              }
            : { context: { token: event.key } },
      },
    },
    pending: {
      on: {
        KEY: ({ context, event }) => ({
          context: {
            deadline: 0,
            prefix: "",
            token:
              event.now < context.deadline &&
              event.key !== "Escape" &&
              !event.key.includes("+")
                ? `${context.prefix} ${event.key}`
                : event.key,
          },
          target: "idle",
        }),
      },
    },
    restore: {
      always: ({ context }) => ({
        target: context.prefix === "" ? "idle" : "pending",
      }),
    },
  },
});

export const sequenceKey = (
  state: Sequence,
  key: string,
  now: number,
  prefixes: readonly string[]
): Context => {
  const [snapshot] = initialTransition(sequenceMachine, { ...state, prefixes });

  return transition(sequenceMachine, snapshot, { key, now, type: "KEY" })[0]
    .context;
};
