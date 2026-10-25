import { normalizeProfileName, ProfileName } from "@calendar/auth/contracts";
import { setupEffect } from "@xstate/effect";
import { Option, Schema } from "effect";
import { initialTransition, transition, types } from "xstate";

import {
  ProfileChange,
  ProfileExit,
  ProfileUi,
  profileNameError,
} from "./model.js";

type State = typeof ProfileUi.Type;

const nameChange = (state: State, value: string): State => ({
  ...state,
  draft: value,
  error: Option.none(),
  mode: value === state.savedName ? "pristine" : "editing",
  validation: Option.none(),
});

export const profileMachine = setupEffect({
  schemas: {
    context: types<State>(),
    events: {
      Continue: Schema.Struct({}),
      Discard: Schema.Struct({}),
      Failed: Schema.Struct({ message: Schema.String }),
      Leave: Schema.Struct({ exit: ProfileExit }),
      Loaded: Schema.Struct({ name: Schema.String }),
      Name: Schema.Struct({ value: Schema.String }),
      Retry: Schema.Struct({}),
      Save: Schema.Struct({}),
      Saved: Schema.Struct({ name: ProfileName }),
    },
    input: ProfileUi,
  },
}).createMachine({
  context: ({ input }) => input,
  initial: "restore",
  states: {
    confirming: {
      on: {
        Continue: {
          context: ({ context }) => ({
            ...context,
            exit: Option.none(),
            mode: "editing",
          }),
          target: "editing",
        },
        Discard: {
          context: ({ context }) => ({
            ...context,
            draft: context.savedName,
            error: Option.none(),
            exit: Option.none(),
            mode: "pristine",
            validation: Option.none(),
          }),
          target: "pristine",
        },
      },
    },
    editing: {
      on: {
        Leave: {
          context: ({ context, event }) => ({
            ...context,
            exit: Option.some(event.exit),
            mode: "confirming",
          }),
          target: "confirming",
        },
        Name: ({ context, event }) => {
          const next = nameChange(context, event.value);

          return { context: next, target: next.mode };
        },
        Save: ({ context }) => {
          const valid = Option.isSome(normalizeProfileName(context.draft));
          const mode = valid ? "saving" : "editing";

          return {
            context: {
              ...context,
              error: Option.none(),
              mode,
              sequence: context.sequence + (valid ? 1 : 0),
              validation: profileNameError(context.draft),
            },
            target: mode,
          };
        },
      },
    },
    idle: {},
    "load-failed": {
      on: {
        Retry: {
          context: ({ context }) => ({
            ...context,
            error: Option.none(),
            mode: "loading",
            sequence: context.sequence + 1,
          }),
          target: "loading",
        },
      },
    },
    loading: {
      on: {
        Failed: {
          context: ({ context, event }) => ({
            ...context,
            error: Option.some(event.message),
            mode: "load-failed",
          }),
          target: "load-failed",
        },
        Loaded: {
          context: ({ context, event }) => ({
            ...context,
            draft: event.name,
            error: Option.none(),
            mode: "pristine",
            savedName: event.name,
          }),
          target: "pristine",
        },
      },
    },
    pristine: {
      on: {
        Name: ({ context, event }) => {
          const next = nameChange(context, event.value);

          return { context: next, target: next.mode };
        },
      },
    },
    restore: { always: ({ context }) => ({ target: context.mode }) },
    saving: {
      on: {
        Failed: {
          context: ({ context, event }) => ({
            ...context,
            error: Option.some(event.message),
            mode: "editing",
          }),
          target: "editing",
        },
        Saved: {
          context: ({ context, event }) => ({
            ...context,
            draft: event.name,
            error: Option.none(),
            mode: "pristine",
            savedName: event.name,
          }),
          target: "pristine",
        },
      },
    },
  },
});

export const stepProfile = (
  state: State,
  event: Parameters<typeof profileMachine.transition>[1]
): State => {
  const [snapshot] = initialTransition(profileMachine, state);

  return transition(profileMachine, snapshot, event)[0].context;
};

export const changeProfile = (
  state: State,
  change: typeof ProfileChange.Type
): State =>
  ProfileChange.match(change, {
    Continue: () => stepProfile(state, { type: "Continue" }),
    Discard: () => stepProfile(state, { type: "Discard" }),
    Name: ({ value }) => stepProfile(state, { type: "Name", value }),
    Retry: () => stepProfile(state, { type: "Retry" }),
    Save: () => stepProfile(state, { type: "Save" }),
  });
