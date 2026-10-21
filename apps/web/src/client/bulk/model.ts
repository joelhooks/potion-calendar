import { Schema } from "effect";

import { BulkPlan, BulkReceipt } from "../../layout/bulk-plans.js";
import { SelectionSet } from "../../layout/selection-set.js";
import { EditorMutation } from "../editing/editor-session-model.js";

export const BulkExecution = Schema.Struct({
  id: Schema.String,
  mutations: Schema.Array(EditorMutation),
  plan: BulkPlan,
  receipts: Schema.Array(BulkReceipt),
  selection: SelectionSet,
});

export const BulkView = Schema.TaggedUnion({
  Idle: {},
  Running: { id: Schema.String, plan: BulkPlan, selection: SelectionSet },
  Settled: { execution: BulkExecution },
  Undoing: { execution: BulkExecution },
});
