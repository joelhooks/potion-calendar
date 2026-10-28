import { CustomVideoCatalog } from "@calendar/calendar/contracts";
import { setupEffect } from "@xstate/effect";
import { Option, Schema } from "effect";
import { initialTransition, transition, types } from "xstate";

import { UserDefaultConferencing } from "./default.js";
import {
  ConferencingSettings,
  ConferencingSettingsChange,
  CustomVideoLinks,
  CustomVideoWrite,
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
  conflicts: state.conflicts,
  defaultConferencing: state.defaultConferencing,
  entries,
  legacyEntries: state.legacyEntries,
});

const reconcile = (
  state: State,
  catalog: typeof CustomVideoCatalog.Type
): State => {
  const pending = Option.getOrUndefined(state.pendingWrite);

  const settled = {
    ...list(state, catalog.entries),
    conflicts: catalog.conflicts,
  };

  if (pending !== undefined && CustomVideoWrite.guards.Save(pending)) {
    const matching = catalog.entries.some(
      (entry) =>
        Option.contains(pending.id, entry.id) &&
        entry.name === pending.name &&
        entry.link === pending.link
    );

    return matching
      ? settled
      : {
          ...state,
          conflicts: catalog.conflicts,
          entries: catalog.entries,
          error: Option.some(
            "The saved catalog does not contain this change. Review the draft before retrying."
          ),
          mode: "editing",
          pendingWrite: Option.none(),
        };
  }

  if (
    pending !== undefined &&
    CustomVideoWrite.guards.Remove(pending) &&
    catalog.entries.some((entry) => entry.id === pending.id)
  ) {
    return {
      ...settled,
      error: Option.some(
        "The link is still saved. Review it before removing it again."
      ),
    };
  }

  return settled;
};

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
      Load: Schema.Struct({}),
      LoadFailed: Schema.Struct({
        message: Schema.String,
        requestId: Schema.Int,
      }),
      Loaded: Schema.Struct({
        catalog: CustomVideoCatalog,
        requestId: Schema.Int,
      }),
      Name: Schema.Struct({ value: Schema.String }),
      Remove: Schema.Struct({ id: Schema.NonEmptyString }),
      Save: Schema.Struct({}),
      Saved: Schema.Struct({
        entries: CustomVideoLinks,
        requestId: Schema.Int,
      }),
      Unconfirmed: Schema.Struct({
        message: Schema.String,
        requestId: Schema.Int,
        write: CustomVideoWrite,
      }),
    },
    input: ConferencingSettings,
  },
}).createMachine({
  context: ({ input }) => input,
  initial: "restore",
  on: {
    Load: ({ context }) =>
      context.mode === "listing" || context.mode === "unconfirmed"
        ? {
            context: {
              ...context,
              error: Option.none(),
              mode: "loading",
              requestId: context.requestId + 1,
            },
            target: ".loading",
          }
        : undefined,
    Unconfirmed: ({ context, event }) =>
      context.requestId === event.requestId &&
      (context.mode === "saving" || context.mode === "removing")
        ? {
            context: {
              ...context,
              draft: CustomVideoWrite.guards.Save(event.write)
                ? {
                    ...context.draft,
                    create: event.write.create ?? Option.isNone(event.write.id),
                    id: event.write.id,
                  }
                : context.draft,
              error: Option.some(event.message),
              mode: "unconfirmed",
              pendingWrite: Option.some(event.write),
            },
            target: ".unconfirmed",
          }
        : undefined,
  },
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
    loading: {
      on: {
        LoadFailed: ({ context, event }) =>
          context.requestId === event.requestId
            ? {
                context: {
                  ...context,
                  error: Option.some(event.message),
                  mode: "unconfirmed",
                },
                target: "unconfirmed",
              }
            : undefined,

        Loaded: ({ context, event }) => {
          const next = reconcile(context, event.catalog);

          return context.requestId === event.requestId
            ? { context: next, target: next.mode }
            : undefined;
        },
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
    unconfirmed: {},
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
    Load: () =>
      transition(conferencingSettingsMachine, snapshot, { type: "Load" })[0]
        .context,
    LoadFailed: ({ message, requestId }) =>
      transition(conferencingSettingsMachine, snapshot, {
        message,
        requestId,
        type: "LoadFailed",
      })[0].context,
    Loaded: ({ catalog, requestId }) =>
      transition(conferencingSettingsMachine, snapshot, {
        catalog,
        requestId,
        type: "Loaded",
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
    Unconfirmed: ({ message, requestId, write }) =>
      transition(conferencingSettingsMachine, snapshot, {
        message,
        requestId,
        type: "Unconfirmed",
        write,
      })[0].context,
  });
};
