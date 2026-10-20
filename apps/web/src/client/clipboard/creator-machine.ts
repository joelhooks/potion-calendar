import { setupEffect } from "@xstate/effect";
import { Option, Schema } from "effect";
import { types } from "xstate";
import type { SnapshotFrom } from "xstate";

import { EditorAction } from "../editing/editor-action.js";
import {
  eventEditorMachine,
  projectEditor,
} from "../editing/editor-machine.js";
import type { EditorSnapshot } from "../editing/editor-machine.js";
import { EditorView } from "../editing/editor-model.js";
import {
  EditorFailure,
  EditorMutation,
  EditorRequest,
} from "../editing/editor-session-model.js";
import { ClipboardInputFailure } from "./model.js";
import { clipboardSendUpdates } from "./template.js";

export const ClipboardCreatorOutcome = Schema.TaggedUnion({
  Abandoned: {},
  Saved: { mutation: EditorMutation.cases.Saved },
});

export const ClipboardCreatorProblem = Schema.Union([
  EditorFailure,
  ClipboardInputFailure,
]);

interface CreatorContext {
  readonly failure: typeof ClipboardCreatorProblem.Type | undefined;
  readonly outcome: typeof ClipboardCreatorOutcome.Type | undefined;
  readonly request: typeof EditorRequest.cases.New.Type;
}

const unsupportedDecision = (view: typeof EditorView.Type): boolean =>
  EditorView.guards.Scope(view) ||
  EditorView.guards.RemoveRecurrence(view) ||
  EditorView.guards.CustomRepeat(view);

export const clipboardCreatorMachine = setupEffect({
  actors: { editor: eventEditorMachine },
  schemas: {
    context: types<CreatorContext>(),
    events: { ABANDON: Schema.Struct({}), RETRY: Schema.Struct({}) },
    input: Schema.Struct({ request: EditorRequest.cases.New }),
  },
}).createMachine({
  context: ({ input }) => ({
    failure: undefined,
    outcome: undefined,
    request: input.request,
  }),
  initial: "active",
  output: ({ context }) => {
    if (context.outcome === undefined) {
      throw new Error("Clipboard creator finished without a confirmed outcome");
    }

    return context.outcome;
  },
  states: {
    active: {
      initial: "booting",
      invoke: {
        id: "editor",
        onError: () => ({
          context: {
            failure: new ClipboardInputFailure({
              message:
                "The paste result could not be confirmed. Check the calendar before trying again.",
              reason: "creationUnconfirmed",
            }),
          },
          target: ".refused",
        }),
        onSnapshot: (
          {
            context,
            event,
          }: { context: CreatorContext; event: { snapshot: EditorSnapshot } },
          enqueue
        ) => {
          const { snapshot } = event;
          const projected = projectEditor(snapshot);
          const { mutation } = snapshot.context;

          if (EditorView.guards.Closed(projected)) {
            if (
              mutation !== undefined &&
              EditorMutation.guards.Saved(mutation)
            ) {
              return {
                context: {
                  outcome: ClipboardCreatorOutcome.cases.Saved.make({
                    mutation,
                  }),
                },
                target: ".done",
              };
            }

            if (
              snapshot.context.error !== undefined ||
              snapshot.context.failure !== undefined
            ) {
              return {
                context: {
                  failure:
                    snapshot.context.failure ??
                    new ClipboardInputFailure({
                      message:
                        snapshot.context.error ??
                        "This copied event cannot be created.",
                      reason: "invalidTemplate",
                    }),
                },
                target: ".refused",
              };
            }

            if (context.request.template === undefined) {
              return {
                context: {
                  failure: new ClipboardInputFailure({
                    message:
                      "This create request has no owned clipboard template.",
                    reason: "invalidTemplate",
                  }),
                },
                target: ".refused",
              };
            }

            if (snapshot.context.request === undefined) {
              enqueue.sendTo("editor", {
                request: context.request,
                type: "OPEN",
              });

              return { target: ".working" };
            }
          }

          if (
            snapshot.context.session !== undefined &&
            snapshot.context.session.direct !== true
          ) {
            return {
              context: {
                failure: new ClipboardInputFailure({
                  message:
                    "Clipboard creation did not enter the normal direct plan.",
                  reason: "invalidTemplate",
                }),
              },
              target: ".refused",
            };
          }

          if (EditorView.guards.Failure(projected)) {
            return {
              context: { failure: projected.failure },
              target: ".failed",
            };
          }

          if (EditorView.guards.Email(projected)) {
            if (
              context.request.template !== undefined &&
              clipboardSendUpdates(context.request.template) === "all"
            ) {
              enqueue.sendTo("editor", {
                action: EditorAction.cases.SendUpdates.make({ send: true }),
                type: "ACTION",
              });

              return { target: ".working" };
            }

            return {
              context: {
                failure: new ClipboardInputFailure({
                  message:
                    "Guest invitations require an explicit clipboard decision.",
                  reason: "invalidTemplate",
                }),
              },
              target: ".refused",
            };
          }

          if (
            EditorView.guards.Editing(projected) &&
            Option.isSome(projected.error)
          ) {
            return {
              context: {
                failure: new ClipboardInputFailure({
                  message: projected.error.value,
                  reason: "invalidTemplate",
                }),
              },
              target: ".refused",
            };
          }

          if (unsupportedDecision(projected)) {
            return {
              context: {
                failure: new ClipboardInputFailure({
                  message:
                    "Clipboard creation requires an unsupported edit decision.",
                  reason: "invalidTemplate",
                }),
              },
              target: ".refused",
            };
          }

          return {};
        },
        src: ({ actors }) => actors.editor,
      },
      onDone: () => ({ target: "finished" }),
      states: {
        abandoned: { type: "final" },
        booting: {},
        done: { type: "final" },
        failed: {
          on: {
            ABANDON: () => ({
              context: {
                outcome: ClipboardCreatorOutcome.cases.Abandoned.make({}),
              },
              target: "abandoned",
            }),
            RETRY: (_args, enqueue) => {
              enqueue.sendTo("editor", {
                action: EditorAction.cases.Retry.make({}),
                type: "ACTION",
              });

              return { context: { failure: undefined }, target: "working" };
            },
          },
        },
        refused: {
          on: {
            ABANDON: () => ({
              context: {
                outcome: ClipboardCreatorOutcome.cases.Abandoned.make({}),
              },
              target: "abandoned",
            }),
          },
        },
        working: {},
      },
    },
    finished: { type: "final" },
  },
});

export type ClipboardCreatorSnapshot = SnapshotFrom<
  typeof clipboardCreatorMachine
>;
