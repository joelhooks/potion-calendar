import { Option } from "effect";

import {
  BulkPermission,
  BulkReceipt,
  BulkUndo,
  planBulk,
  summarizeBulk,
} from "../../layout/bulk-plans.js";
import { instantEventEligible } from "../../layout/instant-editing.js";
import { visibleEvents } from "../../layout/presentation.js";
import { primarySelection } from "../../layout/selection-set.js";
import type { AppModel } from "../app.js";
import { editorConferencingContext } from "../conferencing/editor-context.js";
import { savedConferencingNotice } from "../editing/conferencing-notice.js";
import { DeleteOutcome } from "../editing/delete-actor.js";
import { EditorMutation } from "../editing/editor-session-model.js";
import { writableCalendar } from "../editing/load-editor.js";
import { homeZone } from "../time-zones/model.js";
import { bulkFailureReason } from "./failure.js";
import { BulkView } from "./model.js";

export const bulkPlanFor = (
  model: AppModel,
  operation: "delete" | "duplicate",
  intent: "ordinary" | "noEmailOccurrence" = "ordinary"
) =>
  planBulk(
    operation,
    model.calendar.selected,
    visibleEvents(model).map((item) => ({
      event: item.source,
      key: item.key,
      permission:
        (intent !== "noEmailOccurrence" ||
          instantEventEligible(item.source, item.calendar)) &&
        (operation === "delete"
          ? writableCalendar(item.calendar)
          : model.calendar.calendars.some(writableCalendar))
          ? BulkPermission.cases.Allowed.make({})
          : BulkPermission.cases.Blocked.make({
              reason:
                intent === "noEmailOccurrence"
                  ? "This event does not permit an instant change."
                  : "Google does not permit writing to this calendar.",
            }),
    })),
    {
      calendars: model.calendar.calendars,
      conferencingContext: editorConferencingContext(model),
      intent,
      navigation: model.calendar.navigation,
      primaryZone: homeZone(model),
      selection: primarySelection(model.calendar.selected),
    }
  );

export const settledBulk = (model: AppModel) =>
  BulkView.guards.Settled(model.editing.bulk) ||
  BulkView.guards.Undoing(model.editing.bulk)
    ? model.editing.bulk.execution
    : undefined;

export const bulkConferenceNotices = (model: AppModel) =>
  settledBulk(model)
    ?.mutations.filter(EditorMutation.guards.Saved)
    .flatMap((mutation) => Option.toArray(savedConferencingNotice(mutation))) ??
  [];

export const bulkSummary = (model: AppModel) => {
  const execution = settledBulk(model);

  const receipts = execution?.receipts.map((receipt) => {
    if (
      !BulkReceipt.guards.Succeeded(receipt) ||
      !BulkUndo.guards.Available(receipt.undo)
    ) {
      return receipt;
    }

    const { id } = receipt.undo.request;
    const outcome = model.editing.bulkOutcomes[id];

    if (outcome !== undefined && DeleteOutcome.guards.Failed(outcome)) {
      return BulkReceipt.cases.Failed.make({
        key: receipt.key,
        reason: bulkFailureReason(outcome.failure),
      });
    }

    const pending = model.editing.deletes.some(
      (mark) => mark.intent.id === id && mark.phase === "pending"
    );

    return pending
      ? receipt
      : BulkReceipt.cases.Succeeded.make({
          ...receipt,
          undo: BulkUndo.cases.Unavailable.make({
            reason: "This deletion's existing Undo is no longer pending.",
          }),
        });
  });

  return execution === undefined
    ? undefined
    : summarizeBulk(execution.plan, receipts ?? []);
};

export const finishBulkUndo = (model: AppModel, id: string) => {
  if (!BulkView.guards.Undoing(model.editing.bulk)) {
    return model.editing.bulk;
  }

  const ids = new Set(
    model.editing.bulk.execution.mutations
      .filter(EditorMutation.guards.DeletedStaged)
      .map((mutation) => mutation.id)
  );

  const remaining = model.editing.deletes.some(
    (mark) =>
      mark.intent.id !== id &&
      ids.has(mark.intent.id) &&
      mark.phase === "pending"
  );

  return remaining ? model.editing.bulk : BulkView.cases.Idle.make({});
};

export const bulkDeleteSelection = (model: AppModel, id: string) => {
  if (BulkView.guards.Running(model.editing.bulk)) {
    const intent = model.editing.deletes.find(
      (mark) => mark.intent.id === id
    )?.intent;

    const member =
      intent !== undefined &&
      model.editing.bulk.plan.steps.some(
        (step) =>
          step.request.event.accountId === intent.event.accountId &&
          step.request.event.calendarId === intent.event.calendarId &&
          step.request.event.eventId === intent.event.eventId
      );

    return member ? Option.some(model.editing.bulk.selection) : Option.none();
  }

  const execution = settledBulk(model);

  const member = execution?.mutations.some(
    (mutation) =>
      EditorMutation.guards.DeletedStaged(mutation) && mutation.id === id
  );

  return member === true && execution !== undefined
    ? Option.some(execution.selection)
    : Option.none();
};
