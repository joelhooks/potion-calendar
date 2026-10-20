import { CalendarEvent, DeleteEventInput } from "@calendar/calendar/contracts";
import { createEffectLogic, setupEffect } from "@xstate/effect";
import { Context, Effect, Schema } from "effect";
import { types } from "xstate";

import { NavigationState } from "../../layout/navigation.js";
import { MutationFailure } from "./failure.js";
import type { MutationFailureValue } from "./failure.js";

export const undoWindowMilliseconds = 8000;

export const DeleteIntent = Schema.Struct({
  event: CalendarEvent,
  id: Schema.String,
  navigation: NavigationState,
  request: DeleteEventInput,
  selection: Schema.Option(Schema.String),
  title: Schema.String,
});

export type DeleteIntentValue = typeof DeleteIntent.Type;

export const DeleteCommit = Schema.Struct({
  keepalive: Schema.Boolean,
  request: DeleteEventInput,
});

export class DeletionWriter extends Context.Service<
  DeletionWriter,
  {
    readonly commit: (
      input: typeof DeleteCommit.Type
    ) => Effect.Effect<void, MutationFailureValue>;
  }
>()("@calendar/web/DeletionWriter") {}

export const DeleteCommitResult = Schema.TaggedUnion({
  Committed: {},
  Failed: { failure: MutationFailure },
});

export const DeleteOutcome = Schema.TaggedUnion({
  Committed: { id: Schema.String },
  Failed: { failure: MutationFailure, id: Schema.String },
  Undone: { id: Schema.String },
});

interface DeleteContext {
  readonly intent: DeleteIntentValue;
  readonly keepalive: boolean;
  readonly outcome: typeof DeleteOutcome.Type | undefined;
  readonly windowMilliseconds: number;
}

interface DeleteResolution {
  readonly context: Pick<DeleteContext, "outcome">;
  readonly target: "committed" | "failed";
}

const waitForUndo = createEffectLogic({
  effect: ({ input }) => Effect.sleep(input.milliseconds),
  schemas: { input: Schema.Struct({ milliseconds: Schema.Finite }) },
});

const commitDelete = createEffectLogic({
  effect: ({ input }) =>
    DeletionWriter.use((writer) => writer.commit(input)).pipe(
      Effect.match({
        onFailure: (failure) =>
          DeleteCommitResult.cases.Failed.make({ failure }),
        onSuccess: () => DeleteCommitResult.cases.Committed.make({}),
      })
    ),
  schemas: { input: DeleteCommit },
});

export const deleteUndoMachine = setupEffect({
  actors: { commitDelete, waitForUndo },
  schemas: {
    context: types<DeleteContext>(),
    events: {
      DISMISS: Schema.Struct({}),
      PAGE_HIDDEN: Schema.Struct({}),
      UNDO: Schema.Struct({}),
    },
    input: Schema.Struct({
      intent: DeleteIntent,
      windowMilliseconds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    }),
  },
}).createMachine({
  context: ({ input }) => ({
    intent: input.intent,
    keepalive: false,
    outcome: undefined,
    windowMilliseconds: input.windowMilliseconds,
  }),
  initial: "pending",
  output: ({ context }) => context.outcome,
  states: {
    committed: { type: "final" },
    committing: {
      invoke: {
        id: "deleteCommit",
        input: ({ context }) => ({
          keepalive: context.keepalive,
          request: context.intent.request,
        }),
        onDone: ({ context, event }) =>
          DeleteCommitResult.match<DeleteResolution>(event.output, {
            Committed: () => ({
              context: {
                outcome: DeleteOutcome.cases.Committed.make({
                  id: context.intent.id,
                }),
              },
              target: "committed",
            }),
            Failed: ({ failure }) => ({
              context: {
                outcome: DeleteOutcome.cases.Failed.make({
                  failure,
                  id: context.intent.id,
                }),
              },
              target: "failed",
            }),
          }),
        src: "commitDelete",
      },
    },
    failed: { type: "final" },
    pending: {
      invoke: {
        id: "undoWindow",
        input: ({ context }) => ({ milliseconds: context.windowMilliseconds }),
        onDone: { target: "committing" },
        src: "waitForUndo",
      },
      on: {
        DISMISS: { target: "committing" },
        PAGE_HIDDEN: { context: { keepalive: true }, target: "committing" },
        UNDO: {
          context: ({ context }) => ({
            outcome: DeleteOutcome.cases.Undone.make({ id: context.intent.id }),
          }),
          target: "undone",
        },
      },
    },
    undone: { type: "final" },
  },
});
