import { statusEventProperties } from "@calendar/calendar/contracts";
import type {
  CalendarEventValue,
  CalendarRefValue,
} from "@calendar/calendar/contracts";
import { DateTime, Effect, Schema } from "effect";

import {
  EventDraft,
  RepeatForm,
  Weekday,
} from "../client/editing/editor-model.js";
import { EditorInputFailure } from "../client/editing/input-failure.js";
import { eventTimeParts, requireEditorDate } from "./editor-time.js";
import { storedEventZone } from "./editor-zone.js";

const weekdays: readonly (typeof Weekday.Type)[] = [
  "SU",
  "MO",
  "TU",
  "WE",
  "TH",
  "FR",
  "SA",
];

const fail = () =>
  new EditorInputFailure({
    message: "The event's start date could not be prepared.",
  });

const failure = () =>
  new EditorInputFailure({
    message: "The event's date, time or time zone could not be loaded.",
  });

export const initialRepeat = Effect.fn("initialRepeat")(function* initialRepeat(
  startDate: string,
  rules: readonly string[] = []
) {
  const date = yield* requireEditorDate(startDate);
  const parts = DateTime.toPartsUtc(date);

  const weekday = yield* Schema.decodeUnknownEffect(Weekday)(
    weekdays[parts.weekDay]
  ).pipe(Effect.mapError(fail));

  const ordinal = yield* Schema.decodeUnknownEffect(RepeatForm.fields.ordinal)(
    String(Math.ceil(parts.day / 7))
  ).pipe(Effect.mapError(fail));

  return RepeatForm.make({
    count: "10",
    end: "never",
    frequency: "WEEKLY",
    interval: "1",
    monthPattern: "date",
    ordinal,
    preset: rules.length === 0 ? "none" : "unchanged",
    rules,
    until: startDate,
    weekday,
    weekdays: [weekday],
  });
});

export interface CreationDraftInput {
  readonly allDay: boolean;
  readonly endDate: string;
  readonly endTime: string;
  readonly ref: CalendarRefValue;
  readonly startDate: string;
  readonly startTime: string;
  readonly timeZone: string;
}

export const createDraft = Effect.fn("createDraft")(function* createDraft(
  input: CreationDraftInput
) {
  const repeat = yield* initialRepeat(input.startDate);

  return EventDraft.make({
    ...input.ref,
    allDay: input.allDay,
    attachments: [],
    attendees: [],
    colorId: null,
    description: "",
    endDate: input.endDate,
    endTime: input.endTime,
    location: "",
    participantEmail: "",
    reminderInput: "",
    reminders: { overrides: [], useDefault: !input.allDay },
    repeat,
    startDate: input.startDate,
    startTime: input.startTime,
    timeZone: input.timeZone,
    title: "",
  });
});

export const eventDraft = Effect.fn("eventDraft")(function* eventDraft(
  event: CalendarEventValue,
  master: CalendarEventValue | undefined,
  primaryZone: string
) {
  const { start } = event;
  const { end } = event;

  if (
    start === undefined ||
    end === undefined ||
    "date" in start !== "date" in end
  ) {
    return yield* new EditorInputFailure({
      message: "This event has no editable date and time range.",
    });
  }

  const timeZone = storedEventZone(start, master?.start, primaryZone);

  const from = yield* Effect.fromOption(eventTimeParts(start, timeZone)).pipe(
    Effect.mapError(failure)
  );

  const to = yield* Effect.fromOption(eventTimeParts(end, timeZone)).pipe(
    Effect.mapError(failure)
  );

  const allDay = "date" in start;

  const endDate = allDay
    ? DateTime.formatIsoDateUtc(
        DateTime.subtract(yield* requireEditorDate(to.date), { days: 1 })
      )
    : to.date;

  const repeat = yield* initialRepeat(
    from.date,
    master?.recurrence ?? event.recurrence ?? []
  );

  return EventDraft.make({
    accountId: event.accountId,
    allDay,
    attachments: event.attachments,
    attendees: event.attendees ?? [],
    calendarId: event.calendarId,
    colorId: event.colorId ?? null,
    description: event.description ?? "",
    endDate,
    endTime: to.clock,
    eventType: event.eventType,
    location: event.location ?? "",
    participantEmail: "",
    reminderInput: "",
    reminders: {
      overrides: event.reminders?.overrides ?? [],
      useDefault: event.reminders?.useDefault ?? true,
    },
    repeat,
    startDate: from.date,
    startTime: from.clock,
    statusInvitationChoice: statusEventProperties(event)?.autoDeclineMode,
    timeZone,
    title: event.title ?? "",
  });
});
