import { createEffectLogic, setupEffect } from "@xstate/effect";
import { Effect, Schema } from "effect";
import { types } from "xstate";

import {
  BulkPlan,
  BulkReceipt,
  BulkUndo,
  bindBulkWrite,
} from "../../layout/bulk-plans.js";
import { SelectionSet } from "../../layout/selection-set.js";
import { DeleteCommand } from "../editing/deletion-session.js";
import { EditorMutation } from "../editing/editor-session-model.js";
import { loadEditor } from "../editing/load-editor.js";
import { prepareEditor } from "../editing/prepare-editor.js";
import { writeEditor } from "../editing/write-editor.js";
import { bulkFailureReason } from "./failure.js";
import { BulkExecution, BulkView } from "./model.js";

const BulkRequest = Schema.Struct({
  id: Schema.String,
  plan: BulkPlan,
  selection: SelectionSet,
});

const executeBulk = createEffectLogic({
  effect: ({ input }) =>
    Effect.gen(function* executeSelectedMembers() {
      const mutations: (typeof EditorMutation.Type)[] = [];
      const receipts: (typeof BulkReceipt.Type)[] = [];

      for (const step of input.plan.steps) {
        const receipt = yield* Effect.gen(function* bulkMember() {
          const session = yield* loadEditor(step.request);
          const prepared = yield* prepareEditor(session);
          const bound = yield* bindBulkWrite(step, prepared);
          const mutation = yield* writeEditor(bound);
          mutations.push(mutation);

          const undo = EditorMutation.guards.DeletedStaged(mutation)
            ? BulkUndo.cases.Available.make({
                request: DeleteCommand.cases.Undo.make({
                  id: mutation.intent.id,
                }),
              })
            : BulkUndo.cases.Unavailable.make({
                reason: "The existing duplicate path does not support Undo.",
              });

          return BulkReceipt.cases.Succeeded.make({ key: step.key, undo });
        }).pipe(
          Effect.catch((error) =>
            Effect.succeed(
              BulkReceipt.cases.Failed.make({
                key: step.key,
                reason: bulkFailureReason(error),
              })
            )
          )
        );

        receipts.push(receipt);
      }

      return BulkExecution.make({ ...input, mutations, receipts });
    }),
  schemas: { input: BulkRequest },
});

export const bulkMachine = setupEffect({
  actors: { executeBulk },
  schemas: {
    context: types<{ readonly view: typeof BulkView.Type }>(),
    events: { CLEAR: Schema.Struct({}), RUN: BulkRequest },
  },
}).createMachine({
  context: { view: BulkView.cases.Idle.make({}) },
  initial: "idle",
  states: {
    idle: {
      on: {
        RUN: {
          context: ({ event }) => ({
            view: BulkView.cases.Running.make(event),
          }),
          target: "running",
        },
      },
    },
    running: {
      invoke: {
        input: ({ context }) => {
          if (!BulkView.guards.Running(context.view)) {
            throw new Error("The bulk actor has no running request.");
          }

          return {
            id: context.view.id,
            plan: context.view.plan,
            selection: context.view.selection,
          };
        },
        onDone: {
          context: ({ event }) => ({
            view: BulkView.cases.Settled.make({ execution: event.output }),
          }),
          target: "settled",
        },
        src: "executeBulk",
      },
    },
    settled: {
      on: {
        CLEAR: {
          context: { view: BulkView.cases.Idle.make({}) },
          target: "idle",
        },
        RUN: {
          context: ({ event }) => ({
            view: BulkView.cases.Running.make(event),
          }),
          target: "running",
        },
      },
    },
  },
});
