import { normalizeProfileName, ProfileName } from "@calendar/auth/contracts";
import { AccountSummary } from "@calendar/core/contracts";
import { setupEffect } from "@xstate/effect";
import { Option, Schema } from "effect";
import { initialTransition, transition, types } from "xstate";

import {
  ProfileChange,
  ProfileExit,
  ProfileUi,
  profileNameError,
  profileValuesDirty,
} from "./model.js";

type State = typeof ProfileUi.Type;

const nameChange = (state: State, value: string): State => ({
  ...state,
  draft: value,
  error: Option.none(),
  mode: profileValuesDirty({ ...state, draft: value }) ? "editing" : "pristine",
  validation: Option.none(),
});

const primaryChange = (state: State, accountId: string): State => {
  if (
    !state.accounts.some(
      (account) => account.id === accountId && !account.disconnected
    )
  ) {
    return state;
  }

  const next = { ...state, draftPrimaryAccountId: Option.some(accountId) };

  return {
    ...next,
    error: Option.none(),
    mode: profileValuesDirty(next) ? "editing" : "pristine",
    validation: Option.none(),
  };
};

export const profileMachine = setupEffect({
  schemas: {
    context: types<State>(),
    events: {
      Continue: Schema.Struct({}),
      Discard: Schema.Struct({}),
      Failed: Schema.Struct({ message: Schema.String }),
      Leave: Schema.Struct({ exit: ProfileExit }),
      Loaded: Schema.Struct({
        accounts: Schema.optionalKey(Schema.Array(AccountSummary)),
        name: Schema.String,
        primaryAccountId: Schema.optionalKey(Schema.Option(Schema.String)),
        proof: Schema.optionalKey(Schema.String),
      }),
      Name: Schema.Struct({ value: Schema.String }),
      Primary: Schema.Struct({ accountId: Schema.String }),
      Retry: Schema.Struct({}),
      Save: Schema.Struct({}),
      Saved: Schema.Struct({
        name: ProfileName,
        primaryAccountId: Schema.optionalKey(Schema.Option(Schema.String)),
      }),
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
            draftPrimaryAccountId: context.savedPrimaryAccountId,
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
        Primary: ({ context, event }) => {
          const next = primaryChange(context, event.accountId);

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
            accounts: event.accounts ?? context.accounts,
            draft: event.name,
            draftPrimaryAccountId:
              event.primaryAccountId ?? context.draftPrimaryAccountId,
            error: Option.none(),
            mode: "pristine",
            proof: event.proof ?? context.proof,
            savedName: event.name,
            savedPrimaryAccountId:
              event.primaryAccountId ?? context.savedPrimaryAccountId,
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
        Primary: ({ context, event }) => {
          const next = primaryChange(context, event.accountId);

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
            draftPrimaryAccountId:
              event.primaryAccountId ?? context.draftPrimaryAccountId,
            error: Option.none(),
            mode: "pristine",
            savedName: event.name,
            savedPrimaryAccountId:
              event.primaryAccountId ?? context.draftPrimaryAccountId,
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
    Primary: ({ accountId }) =>
      stepProfile(state, { accountId, type: "Primary" }),
    Retry: () => stepProfile(state, { type: "Retry" }),
    Save: () => stepProfile(state, { type: "Save" }),
  });
