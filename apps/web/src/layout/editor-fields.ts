import {
  Attendee,
  googleCalendarCapabilities,
} from "@calendar/calendar/contracts";
import type {
  EventFieldsValue,
  ReminderValue,
} from "@calendar/calendar/contracts";
import { DateTime, Effect, Schema } from "effect";

import type { EventDraftValue } from "../client/editing/editor-model.js";
import { EditorInputFailure } from "../client/editing/input-failure.js";
import type { ChangedEventField } from "./edit-scope.js";
import { noEmailOnlyFields } from "./edit-scope.js";
import { repeatRules } from "./editor-repeat.js";
import { requireEditorDate, requireEditorTime } from "./editor-time.js";
import { requireEditorZone } from "./editor-zone.js";

const Email = Schema.String.check(Schema.isPattern(/^[^@\s]+@[^@\s]+$/u));

export const addParticipant = Effect.fn("addParticipant")(
  function* addParticipant(draft: EventDraftValue) {
    const email = yield* Schema.decodeEffect(Email)(
      draft.participantEmail.trim()
    ).pipe(
      Effect.mapError(
        () =>
          new EditorInputFailure({
            message: "Enter a valid participant email address.",
          })
      )
    );

    if (
      draft.attendees.some(
        (person) => person.email.toLowerCase() === email.toLowerCase()
      )
    ) {
      return yield* new EditorInputFailure({
        message: "That participant is already included.",
      });
    }

    const person = Attendee.make({
      email,
      optional: false,
      responseStatus: "needsAction",
    });

    return {
      ...draft,
      attendees: [...draft.attendees, person],
      participantEmail: "",
    };
  }
);

export const draftEventFields = Effect.fn("draftEventFields")(
  function* draftEventFields(draft: EventDraftValue) {
    if (
      draft.reminders.overrides.length >
      googleCalendarCapabilities.maxRemindersCount
    ) {
      return yield* new EditorInputFailure({
        message: `Reminders limited to ${googleCalendarCapabilities.maxRemindersCount}`,
      });
    }

    const timeZone = draft.allDay
      ? draft.timeZone
      : yield* requireEditorZone(draft.timeZone);

    const recurrence = yield* repeatRules({
      allDay: draft.allDay,
      repeat: draft.repeat,
      startDate: draft.startDate,
      timeZone,
    });

    const common = {
      attendees: draft.attendees,
      colorId: draft.colorId,
      description: draft.description,
      location: draft.location,
      recurrence,
      reminders: draft.reminders.useDefault
        ? { useDefault: true }
        : { overrides: draft.reminders.overrides, useDefault: false },
      title: draft.title,
    };

    if (draft.allDay) {
      const from = yield* requireEditorDate(draft.startDate);
      const last = yield* requireEditorDate(draft.endDate);

      if (DateTime.toEpochMillis(last) < DateTime.toEpochMillis(from)) {
        return yield* new EditorInputFailure({
          message: "The last day cannot precede the start date.",
        });
      }

      return {
        ...common,
        end: {
          date: DateTime.formatIsoDateUtc(DateTime.add(last, { days: 1 })),
        },
        start: { date: draft.startDate },
      } satisfies EventFieldsValue;
    }

    const from = yield* requireEditorTime(
      draft.startDate,
      draft.startTime,
      timeZone
    );

    const to = yield* requireEditorTime(draft.endDate, draft.endTime, timeZone);

    if (DateTime.toEpochMillis(to) <= DateTime.toEpochMillis(from)) {
      return yield* new EditorInputFailure({
        message: "The end time must be after the start time.",
      });
    }

    return {
      ...common,
      end: { dateTime: DateTime.formatIso(to), timeZone },
      start: { dateTime: DateTime.formatIso(from), timeZone },
    } satisfies EventFieldsValue;
  }
);

const editableFields: readonly ChangedEventField[] = [
  "attendees",
  "colorId",
  "description",
  "end",
  "location",
  "recurrence",
  "reminders",
  "start",
  "title",
];

export type DraftFields = Effect.Success<ReturnType<typeof draftEventFields>>;

type MutableFields = {
  -readonly [Key in keyof EventFieldsValue]: EventFieldsValue[Key];
};

const scalarChanges = (
  draft: EventDraftValue,
  baseline: EventDraftValue,
  fields: DraftFields
): MutableFields => {
  const changes: MutableFields = {};

  if (draft.title !== baseline.title) {
    changes.title = fields.title;
  }

  if (draft.description !== baseline.description) {
    changes.description = fields.description;
  }

  if (draft.location !== baseline.location) {
    changes.location = fields.location;
  }

  if (draft.colorId !== baseline.colorId) {
    changes.colorId = fields.colorId;
  }

  if (JSON.stringify(draft.reminders) !== JSON.stringify(baseline.reminders)) {
    changes.reminders = fields.reminders;
  }

  return changes;
};

const applyTimeChanges = (
  changes: MutableFields,
  draft: EventDraftValue,
  baseline: EventDraftValue,
  fields: DraftFields
): void => {
  if (
    draft.allDay !== baseline.allDay ||
    draft.startDate !== baseline.startDate ||
    draft.startTime !== baseline.startTime ||
    draft.timeZone !== baseline.timeZone
  ) {
    changes.start = fields.start;
  }

  if (
    draft.allDay !== baseline.allDay ||
    draft.endDate !== baseline.endDate ||
    draft.endTime !== baseline.endTime ||
    draft.timeZone !== baseline.timeZone
  ) {
    changes.end = fields.end;
  }
};

export const draftChanges = (
  draft: EventDraftValue,
  baseline: EventDraftValue,
  fields: DraftFields
) => {
  const dayChanged =
    draft.allDay !== baseline.allDay ||
    draft.startDate !== baseline.startDate ||
    draft.endDate !== baseline.endDate;

  const repeatChanged =
    JSON.stringify(fields.recurrence ?? []) !==
    JSON.stringify(baseline.repeat.rules);

  const removeRecurrence =
    repeatChanged &&
    baseline.repeat.rules.length > 0 &&
    (fields.recurrence?.length ?? 0) === 0;

  const participantsChanged =
    JSON.stringify(draft.attendees) !== JSON.stringify(baseline.attendees);

  const calendarMoved =
    draft.accountId !== baseline.accountId ||
    draft.calendarId !== baseline.calendarId;

  const changes = scalarChanges(draft, baseline, fields);
  applyTimeChanges(changes, draft, baseline, fields);

  if (participantsChanged) {
    changes.attendees = fields.attendees;
  }

  if (repeatChanged && !removeRecurrence) {
    changes.recurrence = fields.recurrence;
  }

  const names = editableFields.filter((field) => field in changes);

  if (calendarMoved) {
    names.push("calendar");
  }

  if (removeRecurrence) {
    names.push("recurrence");
  }

  return {
    calendarMoved,
    changes,
    dayChanged,
    noEmailOnly:
      draft.conferencing?.request === undefined && noEmailOnlyFields(names),
    participantsChanged,
    removeRecurrence,
    repeatChanged,
  };
};

export const customReminders = (
  draft: EventDraftValue,
  defaults: readonly ReminderValue[] | undefined
): EventDraftValue => ({
  ...draft,
  reminders: {
    overrides: draft.reminders.useDefault
      ? (defaults ?? [])
      : draft.reminders.overrides,
    useDefault: false,
  },
});
