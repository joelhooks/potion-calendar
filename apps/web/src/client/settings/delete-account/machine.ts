import { setupEffect } from "@xstate/effect";
import { Option, Schema } from "effect";
import { initialTransition, transition, types } from "xstate";

import { AccountDeletionUi, initialAccountDeletion } from "./model.js";

const cancel = (state: typeof AccountDeletionUi.Type) => ({
  ...initialAccountDeletion(state.sequence + 1),
});

const confirm = (state: typeof AccountDeletionUi.Type) => ({
  ...state,
  error: Option.none(),
  mode: "deleting" as const,
  sequence: state.sequence + 1,
});

export const accountDeletionUiMachine = setupEffect({
  schemas: {
    context: types<typeof AccountDeletionUi.Type>(),
    events: {
      Cancel: Schema.Struct({}),
      Confirm: Schema.Struct({}),
      Deleted: Schema.Struct({}),
      Failed: Schema.Struct({}),
      Open: Schema.Struct({ personId: Schema.String, proof: Schema.String }),
    },
    input: AccountDeletionUi,
  },
}).createMachine({
  context: ({ input }) => input,
  initial: "restore",
  states: {
    closed: {
      on: {
        Open: {
          context: ({ context, event }) => ({
            ...context,
            error: Option.none(),
            mode: "confirming",
            personId: Option.some(event.personId),
            proof: Option.some(event.proof),
            sequence: context.sequence + 1,
          }),
          target: "confirming",
        },
      },
    },
    confirming: {
      on: {
        Cancel: { context: ({ context }) => cancel(context), target: "closed" },
        Confirm: {
          context: ({ context }) => confirm(context),
          target: "deleting",
        },
      },
    },
    deleted: {},
    deleting: {
      on: {
        Deleted: {
          context: ({ context }) => ({
            ...initialAccountDeletion(context.sequence),
            mode: "deleted",
          }),
          target: "deleted",
        },
        Failed: {
          context: ({ context }) => ({
            ...context,
            error: Option.some(
              "Deletion could not be confirmed. Please try again."
            ),
            mode: "failed",
          }),
          target: "failed",
        },
      },
    },
    failed: {
      on: {
        Cancel: { context: ({ context }) => cancel(context), target: "closed" },
        Confirm: {
          context: ({ context }) => confirm(context),
          target: "deleting",
        },
      },
    },
    restore: { always: ({ context }) => ({ target: context.mode }) },
  },
});

export const stepAccountDeletion = (
  state: typeof AccountDeletionUi.Type,
  event: Parameters<typeof accountDeletionUiMachine.transition>[1]
): typeof AccountDeletionUi.Type => {
  const [snapshot] = initialTransition(accountDeletionUiMachine, state);

  return transition(accountDeletionUiMachine, snapshot, event)[0].context;
};
