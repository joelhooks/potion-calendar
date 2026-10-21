import { setupEffect } from "@xstate/effect";
import { Option, Schema } from "effect";
import { types } from "xstate";
import type { SnapshotFrom } from "xstate";

import { changeEditorLogic } from "./change-editor.js";
import {
  editorMeetUnavailable,
  editorNeedsConferenceReplacement,
} from "./conferencing-draft.js";
import { EditorAction } from "./editor-action.js";
import { EditorView, RepeatForm } from "./editor-model.js";
import {
  EditorChangeResult,
  EditorLoadResult,
  EditorPlanResult,
  EditorRequest,
  EditorWriteResult,
  LoadedEditor,
  WritePlan,
} from "./editor-session-model.js";
import type { EditorFailure, EditorMutation } from "./editor-session-model.js";
import { needsCalendarReview, MutationFailure } from "./failure.js";
import { EditorInputFailure } from "./input-failure.js";
import { loadEditorLogic } from "./load-editor.js";
import { permissionsForEditor, prepareEditorLogic } from "./prepare-editor.js";
import { statusInsertRefusal } from "./status-event-draft.js";
import { writeEditorLogic } from "./write-editor.js";

type EditorState =
  | "closed"
  | "loading"
  | "editing"
  | "changing"
  | "confirmingConferencing"
  | "custom"
  | "validating"
  | "scope"
  | "removal"
  | "email"
  | "saving"
  | "failed";

interface EditorContext {
  readonly action: typeof EditorAction.Type | undefined;
  readonly custom: typeof RepeatForm.Type | undefined;
  readonly error: string | undefined;
  readonly failure: typeof EditorFailure.Type | undefined;
  readonly mutation: typeof EditorMutation.Type | undefined;
  readonly plan: typeof WritePlan.Type | undefined;
  readonly queue: readonly (typeof EditorAction.Type)[];
  readonly request: typeof EditorRequest.Type | undefined;
  readonly session: typeof LoadedEditor.Type | undefined;
}

interface Transition {
  readonly context?: Partial<EditorContext>;
  readonly reenter?: boolean;
  readonly target?: EditorState;
}

const sessionFor = (context: EditorContext) =>
  Schema.decodeUnknownSync(LoadedEditor)(context.session);

const planFor = (context: EditorContext) =>
  Schema.decodeUnknownSync(WritePlan)(context.plan);

const back = (context: EditorContext): Transition => ({
  target: context.session?.operation === "delete" ? "closed" : "editing",
});

const afterChoice = (context: EditorContext): Transition => ({
  target: planFor(context).emailNeeded ? "email" : "saving",
});

const routeAction = (
  context: EditorContext,
  action: typeof EditorAction.Type
): Transition => {
  if (EditorAction.guards.Cancel(action)) {
    return { target: "closed" };
  }

  if (EditorAction.guards.SaveAsEvent(action)) {
    const session = sessionFor(context);

    return statusInsertRefusal(session, context.failure) === undefined
      ? {}
      : {
          context: {
            action: EditorAction.cases.EventTypeSelected.make({
              value: "default",
            }),
            error: undefined,
            failure: undefined,
            queue: [EditorAction.cases.Save.make({})],
          },
          target: "changing",
        };
  }

  if (EditorAction.guards.ConfirmConferencing(action)) {
    return {};
  }

  if (EditorAction.guards.AddMeet(action)) {
    const session = sessionFor(context);

    if (
      editorNeedsConferenceReplacement(session) &&
      editorMeetUnavailable(
        session,
        permissionsForEditor(session).editMeeting
      ) === undefined
    ) {
      return { context: { queue: [] }, target: "confirmingConferencing" };
    }
  }

  if (
    EditorAction.guards.Save(action) ||
    EditorAction.guards.SaveNoEmail(action) ||
    EditorAction.guards.Retry(action)
  ) {
    const session = sessionFor(context);
    let { intent } = session;

    if (!EditorAction.guards.Retry(action)) {
      intent = EditorAction.guards.SaveNoEmail(action)
        ? "noEmailOccurrence"
        : "ordinary";
    }

    return {
      context: {
        error: undefined,
        failure: undefined,
        session: { ...session, intent: intent ?? "ordinary" },
      },
      target: "validating",
    };
  }

  if (
    EditorAction.guards.RepeatPresetSelected(action) &&
    action.value === "custom"
  ) {
    const session = sessionFor(context);

    return {
      context: {
        custom: { ...session.draft.repeat, preset: "custom" },
        error: undefined,
      },
      target: "custom",
    };
  }

  return {
    context: { action, error: undefined, failure: undefined },
    reenter: true,
    target: "changing",
  };
};

const changed = (
  context: EditorContext,
  result: typeof EditorChangeResult.Type
): Transition => {
  const next = EditorChangeResult.match<EditorContext>(result, {
    Changed: ({ session }) => ({ ...context, error: undefined, session }),
    Invalid: ({ message }) => ({ ...context, error: message }),
  });

  const [action] = next.queue;
  const queue = next.queue.slice(1);

  if (action === undefined) {
    return { context: { ...next, queue }, target: "editing" };
  }

  const transition = routeAction({ ...next, queue }, action);

  return { ...transition, context: { ...next, queue, ...transition.context } };
};

const prepared = (result: typeof EditorPlanResult.Type): Transition =>
  EditorPlanResult.match<Transition>(result, {
    Invalid: ({ message }) => ({
      context: { error: message },
      target: "editing",
    }),
    Prepared: ({ plan }) => {
      const context = { plan, session: plan.session };

      if (
        plan.session.operation !== "delete" &&
        plan.session.kind === "edit" &&
        !plan.calendarMoved &&
        !plan.removeRecurrence &&
        Object.keys(plan.changes).length === 0 &&
        plan.session.draft.conferencing?.request === undefined
      ) {
        return { context, target: "closed" };
      }

      if (plan.prompt === "scope") {
        return { context, target: "scope" };
      }

      if (plan.prompt === "removeRecurrence") {
        return { context, target: "removal" };
      }

      return { context, target: plan.emailNeeded ? "email" : "saving" };
    },
  });

const customAction = (
  context: EditorContext,
  action: typeof EditorAction.Type
): Transition => {
  if (EditorAction.guards.Cancel(action)) {
    return { target: "editing" };
  }

  if (EditorAction.guards.RepeatAccepted(action)) {
    return { context: { action }, target: "changing" };
  }

  const { custom } = context;

  if (custom === undefined) {
    return {};
  }

  if (EditorAction.guards.RepeatWeekdayToggled(action)) {
    const weekdays = custom.weekdays.includes(action.weekday)
      ? custom.weekdays.filter((day) => day !== action.weekday)
      : [...custom.weekdays, action.weekday];

    return { context: { custom: { ...custom, weekdays } } };
  }

  if (EditorAction.guards.RepeatFieldEdited(action)) {
    const decoded = Schema.decodeOption(RepeatForm)({
      ...custom,
      [action.field]: action.value,
    });

    return Option.isSome(decoded)
      ? { context: { custom: decoded.value } }
      : { context: { error: "Choose a supported repeat setting." } };
  }

  return {};
};

export const eventEditorMachine = setupEffect({
  actors: {
    changeEditor: changeEditorLogic,
    loadEditor: loadEditorLogic,
    prepareEditor: prepareEditorLogic,
    writeEditor: writeEditorLogic,
  },
  schemas: {
    context: types<EditorContext>(),
    events: {
      ACTION: Schema.Struct({ action: EditorAction }),
      OPEN: Schema.Struct({ request: EditorRequest }),
    },
  },
}).createMachine({
  context: {
    action: undefined,
    custom: undefined,
    error: undefined,
    failure: undefined,
    mutation: undefined,
    plan: undefined,
    queue: [],
    request: undefined,
    session: undefined,
  },
  initial: "closed",
  on: {
    OPEN: ({ event }) => ({
      context: {
        action: undefined,
        custom: undefined,
        error: undefined,
        failure: undefined,
        mutation: undefined,
        plan: undefined,
        queue: [],
        request: event.request,
        session: undefined,
      },
      reenter: true,
      target: ".loading",
    }),
  },
  states: {
    changing: {
      invoke: {
        input: ({ context }) => ({
          action: Schema.decodeUnknownSync(EditorAction)(context.action),
          custom: Option.fromUndefinedOr(context.custom),
          session: sessionFor(context),
        }),
        onDone: ({ context, event }) => changed(context, event.output),
        src: "changeEditor",
      },
      on: {
        ACTION: ({ context, event }) =>
          EditorAction.guards.Cancel(event.action)
            ? { target: "closed" }
            : { context: { queue: [...context.queue, event.action] } },
      },
    },
    closed: {},
    confirmingConferencing: {
      on: {
        ACTION: ({ event }) => {
          if (EditorAction.guards.Cancel(event.action)) {
            return { context: { queue: [] }, target: "editing" };
          }

          return EditorAction.guards.ConfirmConferencing(event.action)
            ? {
                context: { action: event.action, queue: [] },
                target: "changing",
              }
            : {};
        },
      },
    },
    custom: {
      on: {
        ACTION: ({ context, event }) => customAction(context, event.action),
      },
    },
    editing: {
      on: {
        ACTION: ({ context, event }) => routeAction(context, event.action),
      },
    },
    email: {
      on: {
        ACTION: ({ context, event }) => {
          if (EditorAction.guards.SaveNoEmail(event.action)) {
            return routeAction(context, event.action);
          }

          if (EditorAction.guards.Cancel(event.action)) {
            return back(context);
          }

          if (EditorAction.guards.SendUpdates(event.action)) {
            return {
              context: {
                plan: {
                  ...planFor(context),
                  sendUpdates: event.action.send ? "all" : "none",
                },
              },
              target: "saving",
            };
          }

          return {};
        },
      },
    },
    failed: {
      on: {
        ACTION: ({ context, event }) => {
          if (
            Schema.is(MutationFailure)(context.failure) &&
            needsCalendarReview(context.failure)
          ) {
            return EditorAction.guards.Cancel(event.action)
              ? { target: "closed" }
              : {};
          }

          return routeAction(context, event.action);
        },
      },
    },
    loading: {
      invoke: {
        input: ({ context }) =>
          Schema.decodeUnknownSync(EditorRequest)(context.request),
        onDone: ({ event }) =>
          EditorLoadResult.match<Transition>(event.output, {
            Failed: ({ failure }) => ({
              context: {
                error:
                  "The event could not be prepared. Refresh and try again.",
                failure,
              },
              target: "closed",
            }),
            Loaded: ({ session }) => ({
              context: { session },
              target:
                session.operation === "delete" || session.direct === true
                  ? "validating"
                  : "editing",
            }),
          }),
        src: "loadEditor",
      },
      on: {
        ACTION: ({ event }) =>
          EditorAction.guards.Cancel(event.action) ? { target: "closed" } : {},
      },
    },
    removal: {
      on: {
        ACTION: ({ context, event }) => {
          if (EditorAction.guards.ConfirmRemoval(event.action)) {
            return afterChoice(context);
          }

          return EditorAction.guards.Cancel(event.action) ? back(context) : {};
        },
      },
    },
    saving: {
      invoke: {
        input: ({ context }) => planFor(context),
        onDone: ({ event }) =>
          EditorWriteResult.match<Transition>(event.output, {
            Failed: ({ failure }) => ({
              context: { failure },
              target: "failed",
            }),
            Saved: ({ mutation }) => ({
              context: { mutation },
              target: "closed",
            }),
          }),
        src: "writeEditor",
      },
      on: { OPEN: {} },
    },
    scope: {
      on: {
        ACTION: ({ context, event }) => {
          const plan = planFor(context);

          if (EditorAction.guards.SaveNoEmail(event.action)) {
            return routeAction(context, event.action);
          }

          if (EditorAction.guards.Cancel(event.action)) {
            return back(context);
          }

          if (EditorAction.guards.ConfirmScope(event.action)) {
            return afterChoice(context);
          }

          if (
            EditorAction.guards.ScopeSelected(event.action) &&
            plan.choices.includes(event.action.value)
          ) {
            return {
              context: { plan: { ...plan, scope: event.action.value } },
            };
          }

          return {};
        },
      },
    },
    validating: {
      invoke: {
        input: ({ context }) => sessionFor(context),
        onDone: ({ event }) => prepared(event.output),
        src: "prepareEditor",
      },
    },
  },
});

export type EditorSnapshot = SnapshotFrom<typeof eventEditorMachine>;

export const projectEditor = (
  snapshot: EditorSnapshot
): typeof EditorView.Type => {
  const { context } = snapshot;

  if (snapshot.matches("closed")) {
    return EditorView.cases.Closed.make({});
  }

  if (snapshot.matches("loading")) {
    return EditorView.cases.Loading.make({
      label: "Loading the current event and repeat rule…",
    });
  }

  const session = sessionFor(context);

  const fields = {
    draft: session.draft,
    error: Option.fromUndefinedOr(
      context.error ??
        (Schema.is(EditorInputFailure)(context.failure)
          ? context.failure.message
          : undefined)
    ),
    kind: session.kind,
    moveSupport: session.moveSupport,
    operation: session.operation,
    original: session.original,
    permissions: permissionsForEditor(session),
  };

  if (snapshot.matches("confirmingConferencing")) {
    return EditorView.cases.ConfirmConferencing.make(fields);
  }

  if (snapshot.matches("custom")) {
    return EditorView.cases.CustomRepeat.make({
      ...fields,
      custom: Schema.decodeUnknownSync(RepeatForm)(context.custom),
    });
  }

  if (snapshot.matches("scope")) {
    const plan = planFor(context);

    return EditorView.cases.Scope.make({
      ...fields,
      choices: plan.choices,
      selected: Option.some(plan.scope),
    });
  }

  if (snapshot.matches("email")) {
    return EditorView.cases.Email.make(fields);
  }

  if (snapshot.matches("removal")) {
    return EditorView.cases.RemoveRecurrence.make(fields);
  }

  if (snapshot.matches("saving")) {
    return EditorView.cases.Saving.make(fields);
  }

  if (
    snapshot.matches("failed") &&
    Schema.is(MutationFailure)(context.failure)
  ) {
    return EditorView.cases.Failure.make({
      ...fields,
      failure: context.failure,
    });
  }

  return EditorView.cases.Editing.make(fields);
};
