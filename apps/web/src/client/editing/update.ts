import type { CalendarRefValue } from "@calendar/calendar/contracts";
import { Match, Option, Schema } from "effect";
import type { Update } from "foldkit";

import { creationPosition } from "../../layout/edit-time.js";
import { mutationFailureMessage } from "../../layout/mutation-failure.js";
import {
  NavigationState,
  isoFromDay,
  visibleDays,
} from "../../layout/navigation.js";
import { visibleEvents } from "../../layout/presentation.js";
import { primarySelection } from "../../layout/selection-set.js";
import type { AppModel, AppMessage } from "../app.js";
import { BulkView } from "../bulk/model.js";
import {
  bulkPlanFor,
  bulkSummary,
  bulkDeleteSelection,
  finishBulkUndo,
} from "../bulk/selection.js";
import { eventKey } from "../calendar-state.js";
import { editorConferencingContext } from "../conferencing/editor-context.js";
import { defaultCreationCalendar } from "../settings/update.js";
import { homeZone } from "../time-zones/model.js";
import { DispatchEditing } from "./commands.js";
import { savedConferencingNotice } from "./conferencing-notice.js";
import { DeleteOutcome } from "./delete-actor.js";
import { DeleteNotice } from "./deletion-session.js";
import { EditorAction } from "./editor-action.js";
import { EditorView } from "./editor-model.js";
import { EditorMutation, EditorRequest } from "./editor-session-model.js";
import { needsCalendarReview } from "./failure.js";
import { gestureTarget } from "./gesture-input.js";
import type { GestureResult } from "./gesture-model.js";
import {
  instantDeleteEligible,
  instantSaveEligible,
  instantSavedReceipt,
} from "./instant.js";
import { RsvpResult } from "./rsvp-machine.js";
import { EditingCommand, EditingNotice } from "./runtime.js";
import type { EditingRuntime } from "./runtime.js";
import { DeleteMark } from "./ui-model.js";

type Result = Update.Return<AppModel, AppMessage, EditingRuntime>;

const clock = (minute: number): string =>
  `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

const dispatch = (
  model: AppModel,
  command: typeof EditingCommand.Type
): Result =>
  Option.match(model.person, {
    onNone: () => ({ model }),
    onSome: (personId) => ({
      commands: [DispatchEditing({ command, personId })],
      model,
    }),
  });

const creationCalendar = defaultCreationCalendar;

export const completeGesture = (
  model: AppModel,
  gesture: typeof GestureResult.Type
): Result => {
  if (!EditorView.guards.Closed(model.editing.view)) {
    return { model };
  }

  const common = {
    calendars: model.calendar.calendars,
    conferencingContext: editorConferencingContext(model),
    navigation: model.calendar.navigation,
    primaryZone: homeZone(model),
    rangeZone: model.calendar.zone,
    selection: primarySelection(model.calendar.selected),
  };

  if (Option.isSome(gesture.target)) {
    const captured = gesture.target.value;

    const origin = eventKey(captured.event);

    const [current] = visibleEvents(model).flatMap((item) =>
      item.copies
        .filter((copy) => eventKey(copy.source) === origin)
        .map((copy) => ({
          ...item,
          calendar: copy.calendar,
          source: copy.source,
        }))
    );

    const target =
      current === undefined
        ? undefined
        : Option.getOrUndefined(gestureTarget(current, model.calendar.zone));

    if (target === undefined) {
      return {
        model: {
          ...model,
          error: Option.some(
            "This event is no longer available in the current calendar view. No changes were saved."
          ),
        },
      };
    }

    if (
      (captured.editable && !target.editable) ||
      (!target.editable && !gesture.duplicate)
    ) {
      return {
        model: {
          ...model,
          error: Option.some(
            "You no longer have permission to edit this event. No changes were saved."
          ),
        },
      };
    }

    return dispatch(
      model,
      EditingCommand.cases.Open.make({
        request: EditorRequest.cases.Existing.make({
          ...common,
          event: target.event,
          intent: gesture.duplicate
            ? "ordinary"
            : (gesture.intent ?? "ordinary"),
          mode: gesture.duplicate ? "duplicate" : "edit",
          range: gesture.range,
          selection: Option.some(target.key),
        }),
      })
    );
  }

  const target = creationCalendar(model);

  return target === undefined
    ? {
        model: {
          ...model,
          error: Option.some("No writable calendar is available."),
        },
      }
    : dispatch(
        model,
        EditingCommand.cases.Open.make({
          request: EditorRequest.cases.New.make({
            ...common,
            ...gesture.range,
            ref: { accountId: target.accountId, calendarId: target.calendarId },
          }),
        })
      );
};

const openCreate = (model: AppModel): Result => {
  const target = creationCalendar(model);

  if (target === undefined) {
    return {
      model: {
        ...model,
        error: Option.some("No writable calendar is available."),
      },
    };
  }

  const position = creationPosition(
    model.calendar.now,
    homeZone(model),
    visibleDays(model.calendar.navigation)
  );

  const end = position.minute + 30;

  const request = EditorRequest.cases.New.make({
    allDay: false,
    calendars: model.calendar.calendars,
    conferencingContext: editorConferencingContext(model),
    endDate: isoFromDay(position.day + Math.floor(end / 1440)),
    endTime: clock(end % 1440),
    navigation: model.calendar.navigation,
    primaryZone: homeZone(model),
    ref: { accountId: target.accountId, calendarId: target.calendarId },
    selection: primarySelection(model.calendar.selected),
    startDate: isoFromDay(position.day),
    startTime: clock(position.minute),
  });

  return dispatch(model, EditingCommand.cases.Open.make({ request }));
};

const openSelected = (
  model: AppModel,
  mode: "edit" | "duplicate" | "delete",
  intent: "ordinary" | "noEmailOccurrence" = "ordinary"
): Result => {
  const selected = visibleEvents(model).find((item) =>
    Option.contains(primarySelection(model.calendar.selected), item.key)
  );

  if (selected === undefined) {
    return { model };
  }

  return dispatch(
    model,
    EditingCommand.cases.Open.make({
      request: EditorRequest.cases.Existing.make({
        calendars: model.calendar.calendars,
        conferencingContext: editorConferencingContext(model),
        event: selected.source,
        intent,
        mode,
        navigation: model.calendar.navigation,
        primaryZone: homeZone(model),
        selection: primarySelection(model.calendar.selected),
      }),
    })
  );
};

const responseAction = (
  model: AppModel,
  action:
    | typeof EditorAction.cases.Rsvp.Type
    | typeof EditorAction.cases.RsvpNoteEdited.Type
): Result => {
  const selected = visibleEvents(model).find((item) =>
    Option.contains(primarySelection(model.calendar.selected), item.key)
  );

  if (selected === undefined) {
    return { model };
  }

  const command = EditorAction.guards.Rsvp(action)
    ? EditingCommand.cases.Rsvp.make({
        event: selected.source,
        response: action.response,
      })
    : EditingCommand.cases.RsvpNote.make({
        event: selected.source,
        note: action.value,
      });

  return dispatch(model, command);
};

export const editAction = (
  model: AppModel,
  action: typeof EditorAction.Type
): Result => {
  if (
    BulkView.guards.Running(model.editing.bulk) ||
    BulkView.guards.Undoing(model.editing.bulk)
  ) {
    return { model };
  }

  if (
    (EditorAction.guards.DeleteNoEmail(action) &&
      !instantDeleteEligible(model)) ||
    (EditorAction.guards.SaveNoEmail(action) && !instantSaveEligible(model))
  ) {
    return { model };
  }

  if (
    model.calendar.selected.length > 1 &&
    (EditorAction.guards.DeleteNoEmail(action) ||
      EditorAction.guards.DeleteSelected(action) ||
      EditorAction.guards.DuplicateSelected(action))
  ) {
    const plan = bulkPlanFor(
      model,
      EditorAction.guards.DuplicateSelected(action) ? "duplicate" : "delete",
      EditorAction.guards.DeleteNoEmail(action)
        ? "noEmailOccurrence"
        : "ordinary"
    );

    return dispatch(
      model,
      EditingCommand.cases.Bulk.make({
        plan,
        selection: model.calendar.selected,
      })
    );
  }

  return EditorAction.matchOrElse(
    action,
    {
      DeleteNoEmail: () => openSelected(model, "delete", "noEmailOccurrence"),
      DeleteSelected: () => openSelected(model, "delete"),
      DismissConferencingNotice: ({ id }) => ({
        model: {
          ...model,
          editing: {
            ...model.editing,
            conferencingResult: model.editing.conferencingResult.pipe(
              Option.filter((notice) => notice.id !== id)
            ),
          },
        },
      }),
      DismissInstantSave: ({ id }) => ({
        model: {
          ...model,
          editing: {
            ...model.editing,
            instantSaved: model.editing.instantSaved.pipe(
              Option.filter((notice) => notice.id !== id)
            ),
          },
        },
      }),
      DuplicateSelected: () => openSelected(model, "duplicate"),
      OpenCreate: () => openCreate(model),
      OpenEdit: () => openSelected(model, "edit"),
      Rsvp: (response) => responseAction(model, response),
      RsvpNoteEdited: (note) => responseAction(model, note),
    },
    () => dispatch(model, EditingCommand.cases.Action.make({ action }))
  );
};

export const bulkControl = (
  model: AppModel,
  control: "undo" | "dismiss"
): Result => {
  const summary = bulkSummary(model);

  if (
    summary === undefined ||
    Option.isNone(model.person) ||
    BulkView.guards.Undoing(model.editing.bulk)
  ) {
    return { model };
  }

  const personId = model.person.value;

  const commands = summary.undo.map((request) =>
    DispatchEditing({
      command: EditingCommand.cases.Action.make({
        action:
          control === "undo"
            ? EditorAction.cases.Undo.make({ id: request.id })
            : EditorAction.cases.DismissUndo.make({ id: request.id }),
      }),
      personId,
    })
  );

  const execution = BulkView.guards.Settled(model.editing.bulk)
    ? model.editing.bulk.execution
    : undefined;

  const bulk =
    control === "undo" && execution !== undefined && commands.length > 0
      ? BulkView.cases.Undoing.make({ execution })
      : BulkView.cases.Idle.make({});

  if (control === "dismiss") {
    commands.push(
      DispatchEditing({
        command: EditingCommand.cases.ClearBulk.make({}),
        personId,
      })
    );
  }

  return { commands, model: { ...model, editing: { ...model.editing, bulk } } };
};

export const leaveEditing = (model: AppModel): Result =>
  dispatch(model, EditingCommand.cases.Leave.make({}));

interface NoticeResult {
  readonly model: AppModel;
  readonly reload: boolean;
  readonly reconcile?: readonly CalendarRefValue[];
}

const sameNavigation = Schema.toEquivalence(NavigationState);

const deleteSettled = (
  model: AppModel,
  intent: (typeof DeleteNotice.cases.Settled.Type)["intent"],
  outcome: typeof DeleteOutcome.Type
): NoticeResult =>
  DeleteOutcome.match<NoticeResult>(outcome, {
    Committed: () => ({
      model: {
        ...model,
        editing: {
          ...model.editing,
          bulk: finishBulkUndo(model, intent.id),
          deletes: model.editing.deletes.map((mark) =>
            mark.intent.id === intent.id
              ? {
                  ...mark,
                  afterRead: Option.some(model.calendar.rangeRequest + 1),
                  phase: "acknowledged",
                }
              : mark
          ),
        },
      },
      reload: true,
    }),
    Failed: ({ failure }) => ({
      model: {
        ...model,
        editing: {
          ...model.editing,
          bulk: finishBulkUndo(model, intent.id),
          deletes: model.editing.deletes.filter(
            (mark) => mark.intent.id !== intent.id
          ),
        },
        error: Option.some(mutationFailureMessage(failure)),
      },
      reload: false,
    }),
    Undone: () => ({
      model: {
        ...model,
        calendar: {
          ...model.calendar,
          navigation: intent.navigation,
          selected: Option.getOrElse(
            bulkDeleteSelection(model, intent.id),
            () => Option.toArray(intent.selection)
          ),
        },
        editing: {
          ...model.editing,
          bulk: finishBulkUndo(model, intent.id),
          deletes: model.editing.deletes.filter(
            (mark) => mark.intent.id !== intent.id
          ),
        },
      },
      reload: !sameNavigation(model.calendar.navigation, intent.navigation),
    }),
  });

export const mutationReceived = (
  model: AppModel,
  mutation: typeof EditorMutation.Type
): NoticeResult =>
  EditorMutation.match<NoticeResult>(mutation, {
    DeletedStaged: ({ id, intent }) => ({
      model: {
        ...model,
        editing: {
          ...model.editing,
          deletes: model.editing.deletes.some((mark) => mark.intent.id === id)
            ? model.editing.deletes
            : [
                ...model.editing.deletes,
                { afterRead: Option.none(), intent, phase: "pending" },
              ],
          handledMutation: Option.some(id),
          write: Option.none(),
        },
      },
      reload: false,
    }),
    Saved: (saved) => ({
      model: {
        ...model,
        editing: {
          ...model.editing,
          conferencingResult: savedConferencingNotice(saved),
          handledMutation: Option.some(saved.id),
          instantSaved: instantSavedReceipt(saved),
          write: Option.some({
            afterRead: Option.some(model.calendar.rangeRequest + 1),
            plan: saved.plan,
          }),
        },
      },
      reload: true,
    }),
  });

const receiveResponse = (
  model: AppModel,
  view: (typeof EditingNotice.cases.Rsvp.Type)["view"]
): NoticeResult => {
  let next = { ...model, editing: { ...model.editing, rsvp: view } };

  if (Option.isSome(view.saving)) {
    next = {
      ...next,
      editing: {
        ...next.editing,
        response: Option.some({
          afterRead: Option.none(),
          intent: view.saving.value,
        }),
      },
    };
  }

  if (
    Option.isSome(view.result) &&
    view.result.value.intent.id > model.editing.handledResponse
  ) {
    const result = view.result.value;
    next = {
      ...next,
      editing: { ...next.editing, handledResponse: result.intent.id },
    };

    return RsvpResult.match<NoticeResult>(result, {
      Failed: ({ failure }) => ({
        model: {
          ...next,
          editing: { ...next.editing, response: Option.none() },
          error: Option.some(mutationFailureMessage(failure)),
        },
        reload: false,
      }),
      Saved: ({ intent }) => ({
        model: {
          ...next,
          editing: {
            ...next.editing,
            response: Option.some({
              afterRead: Option.some(model.calendar.rangeRequest + 1),
              intent,
            }),
          },
        },
        reload: true,
      }),
    });
  }

  return { model: next, reload: false };
};

export const receiveEditing = (
  model: AppModel,
  personId: string,
  notice: typeof EditingNotice.Type
): NoticeResult => {
  if (!Option.contains(model.person, personId)) {
    return { model, reload: false };
  }

  return EditingNotice.match<NoticeResult>(notice, {
    Bulk: ({ view }) => {
      const fresh =
        BulkView.guards.Running(view) &&
        (!BulkView.guards.Running(model.editing.bulk) ||
          model.editing.bulk.id !== view.id);

      const next = {
        ...model,
        editing: {
          ...model.editing,
          bulk: view,
          bulkOutcomes: fresh ? {} : model.editing.bulkOutcomes,
        },
      };

      if (
        !BulkView.guards.Settled(view) ||
        Option.contains(model.editing.handledBulk, view.execution.id)
      ) {
        return { model: next, reload: false };
      }

      const knownIds = new Set(
        next.editing.deletes.map((mark) => mark.intent.id)
      );

      const staged = view.execution.mutations.flatMap((mutation) => {
        if (
          !EditorMutation.guards.DeletedStaged(mutation) ||
          next.editing.bulkOutcomes[mutation.id] !== undefined ||
          knownIds.has(mutation.id)
        ) {
          return [];
        }

        knownIds.add(mutation.id);

        return [
          DeleteMark.make({
            afterRead: Option.none(),
            intent: mutation.intent,
            phase: "pending",
          }),
        ];
      });

      const accepted = {
        ...next,
        editing: {
          ...next.editing,
          deletes: [...next.editing.deletes, ...staged],
          handledBulk: Option.some(view.execution.id),
        },
      };

      return {
        model: accepted,
        reload: view.execution.mutations.some(EditorMutation.guards.Saved),
      };
    },
    Delete: ({ notice: deletion }) =>
      DeleteNotice.match<NoticeResult>(deletion, {
        Changed: ({ intent, phase }) => ({
          model: {
            ...model,
            calendar: {
              ...model.calendar,
              selected:
                Option.isSome(intent.selection) &&
                model.calendar.selected.includes(intent.selection.value)
                  ? model.calendar.selected.filter(
                      (key) => !Option.contains(intent.selection, key)
                    )
                  : model.calendar.selected,
            },
            editing: {
              ...model.editing,
              deletes: [
                ...model.editing.deletes.filter(
                  (mark) => mark.intent.id !== intent.id
                ),
                { afterRead: Option.none(), intent, phase },
              ],
            },
          },
          reload: false,
        }),
        Settled: ({ intent, outcome }) =>
          deleteSettled(
            BulkView.guards.Idle(model.editing.bulk)
              ? model
              : {
                  ...model,
                  editing: {
                    ...model.editing,
                    bulkOutcomes: {
                      ...model.editing.bulkOutcomes,
                      [intent.id]: outcome,
                    },
                  },
                },
            intent,
            outcome
          ),
      }),
    Editor: (update) => {
      let editing = {
        ...model.editing,
        owner: Option.some(personId),
        view: update.view,
      };

      if (
        update.saving &&
        Option.isSome(update.plan) &&
        update.plan.value.session.operation !== "delete"
      ) {
        editing = {
          ...editing,
          write: Option.some({
            afterRead: Option.none(),
            plan: update.plan.value,
          }),
        };
      }

      if (
        !update.saving &&
        Option.isSome(editing.write) &&
        Option.isNone(editing.write.value.afterRead)
      ) {
        editing = { ...editing, write: Option.none() };
      }

      const next = {
        ...model,
        editing,
        error: Option.isSome(update.error) ? update.error : model.error,
      };

      if (
        EditorView.guards.Failure(update.view) &&
        needsCalendarReview(update.view.failure) &&
        Option.isSome(update.plan)
      ) {
        const { session } = update.plan.value;

        if (!Option.contains(editing.handledRecovery, session.id)) {
          const { failure } = update.view;

          const reconcile = Match.value(failure).pipe(
            Match.tag("SeriesMoveRetimeUncertain", (value) => [
              value.source,
              value.destination,
            ]),
            Match.tag(
              "SeriesMoveRetimePartial",
              "MutationFollowupPartial",
              (value) => [...Option.toArray(session.original), value.movedEvent]
            ),
            Match.orElse(() => [])
          );

          return {
            model: {
              ...next,
              calendar: { ...next.calendar, selected: [] },
              editing: { ...editing, handledRecovery: Option.some(session.id) },
              error: Option.some(
                mutationFailureMessage(failure, model.calendar.calendars)
              ),
            },
            reconcile,
            reload: true,
          };
        }
      }

      if (
        Option.isSome(update.mutation) &&
        !Option.contains(editing.handledMutation, update.mutation.value.id)
      ) {
        return mutationReceived(next, update.mutation.value);
      }

      return { model: next, reload: false };
    },
    Rsvp: ({ view }) => receiveResponse(model, view),
  });
};

export const reconcileEditingRead = (
  model: AppModel,
  accountId: string,
  request: number
): AppModel => ({
  ...model,
  editing: {
    ...model.editing,
    deletes: model.editing.deletes.filter(
      (mark) =>
        !(
          mark.intent.event.accountId === accountId &&
          Option.isSome(mark.afterRead) &&
          request >= mark.afterRead.value
        )
    ),
    response: model.editing.response.pipe(
      Option.filter(
        (mark) =>
          !(
            mark.intent.event.accountId === accountId &&
            Option.isSome(mark.afterRead) &&
            request >= mark.afterRead.value
          )
      )
    ),
    write: model.editing.write.pipe(
      Option.filter(
        (mark) =>
          !(
            mark.plan.session.draft.accountId === accountId &&
            Option.isSome(mark.afterRead) &&
            request >= mark.afterRead.value
          )
      )
    ),
  },
});
