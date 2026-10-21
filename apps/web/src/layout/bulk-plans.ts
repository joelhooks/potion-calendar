import { CalendarEvent } from "@calendar/calendar/contracts";
import { Effect, Option, Schema } from "effect";

import { DeleteCommand } from "../client/editing/deletion-session.js";
import {
  EditorRequest,
  WritePlan,
} from "../client/editing/editor-session-model.js";
import { EditorInputFailure } from "../client/editing/input-failure.js";
import type { SelectionSetValue } from "./selection-set.js";

export const BulkPermission = Schema.TaggedUnion({
  Allowed: {},
  Blocked: { reason: Schema.NonEmptyString },
});

export const BulkCandidate = Schema.Struct({
  event: CalendarEvent,
  key: Schema.NonEmptyString,
  permission: BulkPermission,
});

export const BulkOperation = Schema.Literals(["delete", "duplicate"]);

export const BulkEditorRequest = Schema.Struct({
  ...EditorRequest.cases.Existing.fields,
  mode: BulkOperation,
});

export const BulkStep = Schema.Struct({
  key: Schema.NonEmptyString,
  request: BulkEditorRequest,
  scope: Schema.Literal("single"),
});

export const BulkIssue = Schema.Struct({
  key: Schema.NonEmptyString,
  reason: Schema.NonEmptyString,
  title: Schema.String,
});

export const BulkPlan = Schema.Struct({
  operation: BulkOperation,
  skipped: Schema.Array(BulkIssue),
  steps: Schema.Array(BulkStep),
});

export type BulkOpening = Pick<
  typeof EditorRequest.cases.Existing.Type,
  | "calendars"
  | "conferencingContext"
  | "intent"
  | "navigation"
  | "primaryZone"
  | "selection"
>;

const identity = (event: typeof CalendarEvent.Type): string =>
  JSON.stringify([event.accountId, event.calendarId, event.eventId]);

export const planBulk = (
  operation: typeof BulkOperation.Type,
  selection: SelectionSetValue,
  candidates: readonly (typeof BulkCandidate.Type)[],
  opening: BulkOpening
): typeof BulkPlan.Type => {
  const steps: (typeof BulkStep.Type)[] = [];
  const skipped: (typeof BulkIssue.Type)[] = [];
  const included = new Set<string>();

  for (const key of selection) {
    const candidate = candidates.find((item) => item.key === key);
    const title = candidate?.event.title ?? "Event";
    let reason: string | undefined;

    if (candidate === undefined) {
      reason = "The selected event is no longer available.";
    } else if (BulkPermission.guards.Blocked(candidate.permission)) {
      ({ reason } = candidate.permission);
    } else if (included.has(identity(candidate.event))) {
      reason = "This event is already included in the bulk action.";
    } else if (
      operation === "duplicate" &&
      (candidate.event.start === undefined || candidate.event.end === undefined)
    ) {
      reason = "The event has no complete range to duplicate.";
    }

    if (reason !== undefined || candidate === undefined) {
      skipped.push({
        key,
        reason: reason ?? "The event is unavailable.",
        title,
      });
      continue;
    }

    included.add(identity(candidate.event));
    steps.push(
      BulkStep.make({
        key,
        request: BulkEditorRequest.make({
          ...opening,
          event: candidate.event,
          mode: operation,
          selection: Option.some(key),
        }),
        scope: "single",
      })
    );
  }

  return BulkPlan.make({ operation, skipped, steps });
};

export const bindBulkWrite = Effect.fn("bindBulkWrite")(function* bindBulkWrite(
  step: typeof BulkStep.Type,
  prepared: typeof WritePlan.Type
) {
  const { original } = prepared.session;

  const matches =
    Option.isSome(original) &&
    identity(original.value) === identity(step.request.event);

  const operation =
    step.request.mode === "delete"
      ? prepared.session.operation === "delete"
      : prepared.session.kind === "duplicate" &&
        prepared.session.operation === "save";

  if (
    !matches ||
    !operation ||
    !prepared.choices.includes("single") ||
    prepared.removeRecurrence ||
    prepared.calendarMoved
  ) {
    return yield* new EditorInputFailure({
      message: "This event has no supported single-instance bulk plan.",
    });
  }

  let { fields } = prepared;

  if (step.request.mode === "duplicate") {
    const { start, end } = step.request.event;

    if (start === undefined || end === undefined) {
      return yield* new EditorInputFailure({
        message: "The event has no complete range to duplicate.",
      });
    }

    fields = { ...fields, end, recurrence: [], start };
  }

  return WritePlan.make({
    ...prepared,
    choices: ["single"],
    emailNeeded: false,
    fields,
    prompt: "none",
    scope: "single",
    sendUpdates: "none",
  });
});

export const BulkUndo = Schema.TaggedUnion({
  Available: { request: DeleteCommand.cases.Undo },
  Unavailable: { reason: Schema.NonEmptyString },
});

export const BulkReceipt = Schema.TaggedUnion({
  Failed: { key: Schema.NonEmptyString, reason: Schema.NonEmptyString },
  Succeeded: {
    key: Schema.NonEmptyString,
    undo: BulkUndo,
  },
});

export const summarizeBulk = (
  plan: typeof BulkPlan.Type,
  receipts: readonly (typeof BulkReceipt.Type)[]
) => {
  const succeeded: string[] = [];
  const failed: (typeof BulkIssue.Type)[] = [];
  const pending: string[] = [];
  const undo: (typeof DeleteCommand.cases.Undo.Type)[] = [];
  const undoUnavailable: (typeof BulkIssue.Type)[] = [];
  const undoIds = new Set<string>();

  for (const step of plan.steps) {
    const matches = receipts.filter((receipt) => receipt.key === step.key);
    const [receipt] = matches;
    const title = step.request.event.title ?? "Event";

    if (matches.length !== 1 || receipt === undefined) {
      pending.push(step.key);
      continue;
    }

    if (BulkReceipt.guards.Failed(receipt)) {
      failed.push({ key: step.key, reason: receipt.reason, title });
      continue;
    }

    succeeded.push(step.key);

    if (plan.operation === "duplicate") {
      undoUnavailable.push({
        key: step.key,
        reason: "The existing duplicate path does not support Undo.",
        title,
      });
    } else if (BulkUndo.guards.Unavailable(receipt.undo)) {
      undoUnavailable.push({
        key: step.key,
        reason: receipt.undo.reason,
        title,
      });
    } else if (!undoIds.has(receipt.undo.request.id)) {
      undoIds.add(receipt.undo.request.id);
      undo.push(receipt.undo.request);
    }
  }

  return {
    failed,
    pending,
    skipped: plan.skipped,
    succeeded,
    undo,
    undoUnavailable,
  };
};
