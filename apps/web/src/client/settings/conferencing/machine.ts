import { setupEffect } from "@xstate/effect";
import { Option, Schema } from "effect";
import { initialTransition, transition, types } from "xstate";

import { UserDefaultConferencing } from "./default.js";
import {
  ConferencingSettings,
  ConferencingSettingsChange,
  CustomVideoLinks,
  initialConferencingSettings,
  validateVideoDraft,
} from "./model.js";

type State = typeof ConferencingSettings.Type;

const clearErrors = {
  link: Option.none<string>(),
  name: Option.none<string>(),
};

const beginEdit = (state: State, id?: string): State => {
  const entry = state.entries.find((item) => item.id === id);

  return {
    ...state,
    draft:
      entry === undefined
        ? { id: Option.none(), link: "", name: "" }
        : { id: Option.some(entry.id), link: entry.link, name: entry.name },
    error: Option.none(),
    errors: clearErrors,
    mode: "editing",
  };
};

const list = (state: State, entries = state.entries): State => ({
  ...initialConferencingSettings(state.requestId),
  defaultConferencing: state.defaultConferencing,
  entries,
});

export const conferencingSettingsMachine = setupEffect({
  schemas: {
    context: types<State>(),
    events: {
      Add: Schema.Struct({}),
      Cancel: Schema.Struct({}),
      Default: Schema.Struct({ value: UserDefaultConferencing }),
      DefaultFailed: Schema.Struct({
        message: Schema.String,
        requestId: Schema.Int,
      }),
      DefaultSaved: Schema.Struct({
        requestId: Schema.Int,
        value: UserDefaultConferencing,
      }),
      Edit: Schema.Struct({ id: Schema.NonEmptyString }),
      Failed: Schema.Struct({ message: Schema.String, requestId: Schema.Int }),
      Link: Schema.Struct({ value: Schema.String }),
      Name: Schema.Struct({ value: Schema.String }),
      Remove: Schema.Struct({ id: Schema.NonEmptyString }),
      Save: Schema.Struct({}),
      Saved: Schema.Struct({
        entries: CustomVideoLinks,
        requestId: Schema.Int,
      }),
    },
    input: ConferencingSettings,
  },
}).createMachine({
  context: ({ input }) => input,
  initial: "restore",
  states: {
    editing: {
      on: {
        Cancel: { context: ({ context }) => list(context), target: "listing" },
        Link: {
          context: ({ context, event }) => ({
            ...context,
            draft: { ...context.draft, link: event.value },
            error: Option.none(),
            errors: clearErrors,
          }),
        },
        Name: {
          context: ({ context, event }) => ({
            ...context,
            draft: { ...context.draft, name: event.value },
            error: Option.none(),
            errors: clearErrors,
          }),
        },
        Save: ({ context }) => {
          const validated = validateVideoDraft(context.draft);
          const mode = Option.isSome(validated.value) ? "saving" : "editing";

          return {
            context: {
              ...context,
              error: Option.none(),
              errors: validated.errors,
              mode,
              requestId: context.requestId + (mode === "saving" ? 1 : 0),
            },
            target: mode,
          };
        },
      },
    },
    listing: {
      on: {
        Add: {
          context: ({ context }) => beginEdit(context),
          target: "editing",
        },
        Default: ({ context, event }) =>
          event.value === context.defaultConferencing
            ? undefined
            : {
                context: {
                  ...context,
                  defaultError: Option.none(),
                  mode: "savingDefault",
                  pendingDefault: Option.some(event.value),
                  requestId: context.requestId + 1,
                },
                target: "savingDefault",
              },
        Edit: ({ context, event }) =>
          context.entries.some((entry) => entry.id === event.id)
            ? { context: beginEdit(context, event.id), target: "editing" }
            : undefined,
        Remove: ({ context, event }) =>
          context.entries.some((entry) => entry.id === event.id)
            ? {
                context: {
                  ...beginEdit(context, event.id),
                  mode: "removing",
                  requestId: context.requestId + 1,
                },
                target: "removing",
              }
            : undefined,
      },
    },
    removing: {
      on: {
        Failed: ({ context, event }) =>
          context.requestId === event.requestId
            ? {
                context: {
                  ...list(context),
                  error: Option.some(event.message),
                },
                target: "listing",
              }
            : undefined,
        Saved: ({ context, event }) =>
          context.requestId === event.requestId
            ? { context: list(context, event.entries), target: "listing" }
            : undefined,
      },
    },
    restore: { always: ({ context }) => ({ target: context.mode }) },
    saving: {
      on: {
        Failed: ({ context, event }) =>
          context.requestId === event.requestId
            ? {
                context: {
                  ...context,
                  error: Option.some(event.message),
                  mode: "editing",
                },
                target: "editing",
              }
            : undefined,
        Saved: ({ context, event }) =>
          context.requestId === event.requestId
            ? { context: list(context, event.entries), target: "listing" }
            : undefined,
      },
    },
    savingDefault: {
      on: {
        DefaultFailed: ({ context, event }) =>
          context.requestId === event.requestId
            ? {
                context: {
                  ...list(context),
                  defaultError: Option.some(event.message),
                },
                target: "listing",
              }
            : undefined,
        DefaultSaved: ({ context, event }) =>
          context.requestId === event.requestId &&
          Option.contains(context.pendingDefault, event.value)
            ? {
                context: { ...list(context), defaultConferencing: event.value },
                target: "listing",
              }
            : undefined,
      },
    },
  },
});

export const changeConferencingSettings = (
  state: State,
  change: typeof ConferencingSettingsChange.Type
): State => {
  const [snapshot] = initialTransition(conferencingSettingsMachine, state);

  return ConferencingSettingsChange.match(change, {
    Add: () =>
      transition(conferencingSettingsMachine, snapshot, { type: "Add" })[0]
        .context,
    Cancel: () =>
      transition(conferencingSettingsMachine, snapshot, { type: "Cancel" })[0]
        .context,
    Default: ({ value }) =>
      transition(conferencingSettingsMachine, snapshot, {
        type: "Default",
        value,
      })[0].context,
    DefaultFailed: ({ message, requestId }) =>
      transition(conferencingSettingsMachine, snapshot, {
        message,
        requestId,
        type: "DefaultFailed",
      })[0].context,
    DefaultSaved: ({ value, requestId }) =>
      transition(conferencingSettingsMachine, snapshot, {
        requestId,
        type: "DefaultSaved",
        value,
      })[0].context,
    Edit: ({ id }) =>
      transition(conferencingSettingsMachine, snapshot, { id, type: "Edit" })[0]
        .context,
    Failed: ({ message, requestId }) =>
      transition(conferencingSettingsMachine, snapshot, {
        message,
        requestId,
        type: "Failed",
      })[0].context,
    Link: ({ value }) =>
      transition(conferencingSettingsMachine, snapshot, {
        type: "Link",
        value,
      })[0].context,
    Name: ({ value }) =>
      transition(conferencingSettingsMachine, snapshot, {
        type: "Name",
        value,
      })[0].context,
    Remove: ({ id }) =>
      transition(conferencingSettingsMachine, snapshot, {
        id,
        type: "Remove",
      })[0].context,
    Save: () =>
      transition(conferencingSettingsMachine, snapshot, { type: "Save" })[0]
        .context,
    Saved: ({ entries, requestId }) =>
      transition(conferencingSettingsMachine, snapshot, {
        entries,
        requestId,
        type: "Saved",
      })[0].context,
  });
};
