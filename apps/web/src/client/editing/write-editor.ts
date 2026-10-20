import { createEffectLogic } from "@xstate/effect";
import { Effect, Schema } from "effect";

import { CalendarEditingClient } from "./calendar-client.js";
import { DeleteIntent } from "./delete-actor.js";
import { DeleteCommand, DeletionSession } from "./deletion-session.js";
import {
  EditorMutation,
  EditorWriteResult,
  WritePlan,
} from "./editor-session-model.js";
import { MutationFollowupPartial } from "./failure.js";
import { EditorInputFailure } from "./input-failure.js";

const sourceEvent = (plan: typeof WritePlan.Type) =>
  Effect.fromOption(plan.session.original).pipe(
    Effect.mapError(
      () =>
        new EditorInputFailure({
          message: "The original event is unavailable. Reload before saving.",
        })
    )
  );

const stageDelete = Effect.fn("stageEditorDelete")(function* stageDelete(
  plan: typeof WritePlan.Type
) {
  const event = yield* sourceEvent(plan);

  const intent = DeleteIntent.make({
    event,
    id: plan.session.id,
    navigation: plan.session.navigation,
    request: {
      accountId: event.accountId,
      calendarId: event.calendarId,
      eventId: event.eventId,
      scope: plan.scope,
      sendUpdates: plan.sendUpdates,
    },
    selection: plan.session.selection,
    title: event.title ?? "Event",
  });

  yield* DeletionSession.use((session) =>
    session.dispatch(DeleteCommand.cases.Begin.make({ intent }))
  );

  return EditorMutation.cases.DeletedStaged.make({ id: intent.id, intent });
});

const saveCreated = Effect.fn("saveCreatedEvent")(function* saveCreated(
  plan: typeof WritePlan.Type
) {
  const id = yield* Effect.fromOption(plan.session.createId).pipe(
    Effect.mapError(
      () =>
        new EditorInputFailure({
          message: "The new event identifier is unavailable.",
        })
    )
  );

  const client = yield* CalendarEditingClient;

  const event = yield* client.createEvent({
    accountId: plan.session.draft.accountId,
    calendarId: plan.session.draft.calendarId,
    event: {
      ...plan.fields,
      guestsCanInviteOthers: plan.fields.guestsCanInviteOthers ?? true,
      guestsCanModify: plan.fields.guestsCanModify ?? true,
      guestsCanSeeOtherGuests: plan.fields.guestsCanSeeOtherGuests ?? true,
    },
    id,
    sendUpdates: plan.sendUpdates,
  });

  return EditorMutation.cases.Saved.make({ event, id: plan.session.id, plan });
});

const saveExisting = Effect.fn("saveExistingEvent")(function* saveExisting(
  plan: typeof WritePlan.Type
) {
  const source = yield* sourceEvent(plan);
  const client = yield* CalendarEditingClient;
  let event = source;
  let { changes } = plan;

  if (plan.calendarMoved) {
    if (source.accountId !== plan.session.draft.accountId) {
      return yield* new EditorInputFailure({
        message: "Cross-account moves are not supported.",
      });
    }

    if (
      (source.recurringEventId !== undefined ||
        (source.recurrence?.length ?? 0) > 0) &&
      (changes.start !== undefined || changes.end !== undefined)
    ) {
      if (plan.fields.start === undefined || plan.fields.end === undefined) {
        return yield* new EditorInputFailure({
          message:
            "A complete start and end are required to move and retime a series.",
        });
      }

      event = yield* client.moveAndRetimeSeries({
        accountId: source.accountId,
        calendarId: source.calendarId,
        destination: {
          accountId: plan.session.draft.accountId,
          calendarId: plan.session.draft.calendarId,
        },
        end: plan.fields.end,
        eventId: source.eventId,
        sendUpdates: plan.sendUpdates,
        start: plan.fields.start,
      });
      const { start: _start, end: _end, ...remaining } = changes;
      changes = remaining;
    } else {
      event = yield* client.moveEvent({
        accountId: source.accountId,
        calendarId: source.calendarId,
        destination: {
          accountId: plan.session.draft.accountId,
          calendarId: plan.session.draft.calendarId,
        },
        eventId:
          plan.scope === "all"
            ? (source.recurringEventId ?? source.eventId)
            : source.eventId,
        sendUpdates: plan.sendUpdates,
      });
    }
  }

  if (Object.keys(changes).length > 0 || plan.removeRecurrence) {
    const update = {
      accountId: event.accountId,
      calendarId: event.calendarId,
      changes,
      eventId: event.eventId,
      scope: plan.scope,
      sendUpdates: plan.sendUpdates,
    };

    event = yield* client
      .updateEvent(
        plan.removeRecurrence ? { ...update, removeRecurrence: true } : update
      )
      .pipe(
        Effect.mapError((cause) =>
          !plan.calendarMoved || Schema.is(MutationFollowupPartial)(cause)
            ? cause
            : new MutationFollowupPartial({ cause, movedEvent: event })
        )
      );
  }

  return EditorMutation.cases.Saved.make({ event, id: plan.session.id, plan });
});

export const writeEditor = Effect.fn("writeEditor")(function* writeEditor(
  plan: typeof WritePlan.Type
) {
  if (plan.session.operation === "delete") {
    return yield* stageDelete(plan);
  }

  return yield* plan.session.kind === "edit"
    ? saveExisting(plan)
    : saveCreated(plan);
});

export const writeEditorLogic = createEffectLogic({
  effect: ({ input }) =>
    writeEditor(input).pipe(
      Effect.match({
        onFailure: (failure) =>
          EditorWriteResult.cases.Failed.make({ failure }),
        onSuccess: (mutation) =>
          EditorWriteResult.cases.Saved.make({ mutation }),
      })
    ),
  schemas: { input: WritePlan },
});
