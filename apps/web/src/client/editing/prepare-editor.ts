import {
  googleCalendarCapabilities,
  statusEventType,
} from "@calendar/calendar/contracts";
import { createEffectLogic } from "@xstate/effect";
import { DateTime, Effect, Option } from "effect";

import { scopeOffer } from "../../layout/edit-scope.js";
import type { ScopeEditValue } from "../../layout/edit-scope.js";
import {
  addParticipant,
  customReminders,
  draftChanges,
  draftEventFields,
} from "../../layout/editor-fields.js";
import {
  addReminder,
  parseReminderInput,
} from "../../layout/editor-reminders.js";
import { instantEventEligible } from "../../layout/instant-editing.js";
import { composeClipboardCreationFields } from "../clipboard/template.js";
import { applyEditorConferencingDefault } from "./conferencing-draft.js";
import type { EditorPermissions } from "./editor-model.js";
import {
  EditorPlanResult,
  LoadedEditor,
  WritePlan,
} from "./editor-session-model.js";
import { EditorInputFailure } from "./input-failure.js";
import { writableCalendar } from "./load-editor.js";
import { creationTypeFields } from "./status-event-draft.js";
import {
  statusPolicyScopes,
  validateStatusPolicyDraft,
} from "./status-event-policy.js";

export const permissionsForEditor = (
  session: typeof LoadedEditor.Type
): typeof EditorPermissions.Type => {
  const calendar = session.calendars.find(
    (item) =>
      item.accountId === session.draft.accountId &&
      item.calendarId === session.draft.calendarId
  );

  const writable = calendar !== undefined && writableCalendar(calendar);
  const source = Option.getOrUndefined(session.original);

  const editable =
    writable &&
    (session.kind !== "edit" ||
      source?.organizer?.self === true ||
      source?.guestsCanModify === true);

  const completeGuests = source?.attendeesOmitted !== true;

  return {
    calendarWritable: writable,
    editGuests:
      editable && completeGuests && !statusEventType(session.draft.eventType),
    editMeeting: editable,
    inviteGuests:
      writable &&
      completeGuests &&
      !statusEventType(session.draft.eventType) &&
      (editable || source?.guestsCanInviteOthers === true),
  };
};

const firstOccurrence = (session: typeof LoadedEditor.Type): boolean => {
  const selected = Option.getOrUndefined(session.original);
  const master = Option.getOrUndefined(session.master);
  const anchor = selected?.originalStartTime ?? selected?.start;

  if (master?.start === undefined || anchor === undefined) {
    return false;
  }

  const from = DateTime.make("date" in anchor ? anchor.date : anchor.dateTime);

  const start = DateTime.make(
    "date" in master.start ? master.start.date : master.start.dateTime
  );

  return (
    Option.isSome(from) &&
    Option.isSome(start) &&
    DateTime.toEpochMillis(from.value) === DateTime.toEpochMillis(start.value)
  );
};

const finalizeInputs = Effect.fn("finalizeEditorInputs")(
  function* finalizeInputs(session: typeof LoadedEditor.Type) {
    let { draft } = session;
    const permissions = permissionsForEditor(session);

    if (draft.participantEmail.trim() !== "") {
      if (!permissions.inviteGuests) {
        return yield* new EditorInputFailure({
          message: "Google does not permit changing the guest list here.",
        });
      }

      draft = yield* addParticipant(draft);
    }

    if (draft.reminderInput.trim() !== "") {
      const calendar = session.calendars.find(
        (item) =>
          item.accountId === draft.accountId &&
          item.calendarId === draft.calendarId
      );

      draft = customReminders(draft, calendar?.defaultReminders);
      const minutes = yield* parseReminderInput(draft.reminderInput);

      const overrides = yield* addReminder(
        draft.reminders.overrides,
        minutes,
        googleCalendarCapabilities.maxRemindersCount
      );

      draft = {
        ...draft,
        reminderInput: "",
        reminders: { overrides, useDefault: false },
      };
    }

    return {
      ...session,
      draft: applyEditorConferencingDefault({ ...session, draft }),
    };
  }
);

const operationFor = (
  session: typeof LoadedEditor.Type
): ScopeEditValue["operation"] => {
  if (session.operation === "delete") {
    return "delete";
  }

  return session.kind === "edit" ? "edit" : "create";
};

const repeatChangeFor = (
  delta: ReturnType<typeof draftChanges>
): ScopeEditValue["repeatChange"] => {
  if (delta.removeRecurrence) {
    return "remove";
  }

  return delta.repeatChanged ? "pattern" : "none";
};

const scopeFacts = (
  session: typeof LoadedEditor.Type,
  delta: ReturnType<typeof draftChanges>
): ScopeEditValue => {
  const source = Option.getOrUndefined(session.original);

  const recurring =
    source !== undefined &&
    (source.recurringEventId !== undefined ||
      (source.recurrence?.length ?? 0) > 0);

  return {
    bulk: false,
    calendarMoved: delta.calendarMoved,
    dayChanged: delta.dayChanged,
    eventKind: source?.eventType === "birthday" ? "birthday" : "ordinary",
    eventTypeChanged: false,
    firstOccurrence: firstOccurrence(session),
    noEmailOnly: session.operation === "delete" ? false : delta.noEmailOnly,
    operation: operationFor(session),
    owned: source?.organizer?.self === true,
    participantCancellation: false,
    recurring: session.kind === "edit" && recurring,
    repeatChange: repeatChangeFor(delta),
  };
};

const hasOtherGuests = (session: typeof LoadedEditor.Type): boolean => {
  const source = Option.getOrUndefined(session.original);

  return (
    !statusEventType(session.draft.eventType) &&
    (source?.organizer?.self === false ||
      (source?.attendees ?? []).some((person) => person.self !== true) ||
      session.draft.attendees.some((person) => person.self !== true))
  );
};

const applyInstantIntent = Effect.fn("applyInstantIntent")(
  function* applyInstantIntent(plan: typeof WritePlan.Type) {
    const { session } = plan;

    if (
      session.intent !== "noEmailOccurrence" &&
      session.intent !== "noEmailGesture"
    ) {
      return plan;
    }

    const original = Option.getOrUndefined(session.original);

    const calendar = session.calendars.find(
      (item) =>
        item.accountId === original?.accountId &&
        item.calendarId === original.calendarId
    );

    if (
      original === undefined ||
      !instantEventEligible(original, calendar) ||
      (session.operation !== "delete" &&
        !permissionsForEditor(session).editMeeting)
    ) {
      return yield* new EditorInputFailure({
        message: "This event does not permit an instant change.",
      });
    }

    const singleAllowed =
      plan.choices.includes("single") &&
      !plan.removeRecurrence &&
      !plan.calendarMoved;

    if (session.intent === "noEmailGesture" && !singleAllowed) {
      return yield* new EditorInputFailure({
        message: "This event cannot be changed as a single occurrence.",
      });
    }

    return singleAllowed
      ? WritePlan.make({
          ...plan,
          emailNeeded: false,
          prompt: "none",
          scope: "single",
          sendUpdates: "none",
        })
      : WritePlan.make({
          ...plan,
          session: { ...session, intent: "ordinary" },
        });
  }
);

export const prepareEditor = Effect.fn("prepareEditor")(function* prepareEditor(
  input: typeof LoadedEditor.Type
) {
  const session = yield* finalizeInputs(input);
  const permissions = permissionsForEditor(session);
  yield* validateStatusPolicyDraft(session, permissions.editMeeting);
  const ordinaryFields = yield* draftEventFields(session.draft);

  const fields = yield* creationTypeFields(
    session,
    session.clipboard === undefined
      ? ordinaryFields
      : composeClipboardCreationFields(ordinaryFields, session.clipboard)
  );

  const delta = draftChanges(session.draft, session.baseline, fields);

  if (
    !permissions.calendarWritable ||
    (!permissions.editMeeting &&
      !delta.noEmailOnly &&
      session.operation !== "delete")
  ) {
    return yield* new EditorInputFailure({
      message:
        "This change is not editable with the permissions Google provided.",
    });
  }

  const facts = scopeFacts(session, delta);

  if (
    session.operation !== "delete" &&
    facts.recurring &&
    delta.calendarMoved &&
    session.draft.timeZone !== session.baseline.timeZone
  ) {
    return yield* new EditorInputFailure({
      message:
        "Change the series time zone and its calendar separately. Save one change before making the other.",
    });
  }

  const offer = statusPolicyScopes(scopeOffer(facts), session);

  if (offer.prompt === "unavailable") {
    return yield* new EditorInputFailure({
      message:
        "This combination has no supported repeat scope. Make these changes separately.",
    });
  }

  const scope = delta.removeRecurrence ? "all" : offer.defaultScope;

  if (scope === undefined) {
    return yield* new EditorInputFailure({
      message: "No supported repeat scope is available.",
    });
  }

  const otherGuests = hasOtherGuests(session);

  const plan = WritePlan.make({
    calendarMoved: delta.calendarMoved,
    changes: delta.changes,
    choices: offer.choices,
    dayChanged: delta.dayChanged,
    emailNeeded:
      !(session.kind !== "edit" && statusEventType(session.draft.eventType)) &&
      otherGuests &&
      (session.operation === "delete" ||
        session.kind !== "edit" ||
        !delta.noEmailOnly),
    fields,
    noEmailOnly: delta.noEmailOnly,
    prompt: offer.prompt,
    removeRecurrence: delta.removeRecurrence,
    scope,
    sendUpdates: "none",
    session,
  });

  return yield* applyInstantIntent(plan);
});

export const prepareEditorLogic = createEffectLogic({
  effect: ({ input }) =>
    prepareEditor(input).pipe(
      Effect.match({
        onFailure: (failure) =>
          EditorPlanResult.cases.Invalid.make({ message: failure.message }),
        onSuccess: (plan) => EditorPlanResult.cases.Prepared.make({ plan }),
      })
    ),
  schemas: { input: LoadedEditor },
});
