import { defineContract } from "@calendar/capability/contract";
import { Schema } from "effect";

import { CalendarReadFailure } from "./calendar-read-failure.js";
import { CalendarFailure } from "./errors.js";
import {
  Calendar,
  CalendarEvent,
  CalendarRef,
  ClientEventId,
  Colors,
  EditScope,
  EventFields,
  EventRef,
  Range,
  ResponseStatus,
  SendUpdates,
} from "./model.js";
import { SyncResult } from "./sync-result.js";

export const AccountCalendars = Schema.Union([
  Schema.Struct({
    accountId: Schema.String,
    calendars: Schema.Array(Calendar),
    colors: Colors,
  }),
  Schema.Struct({ accountId: Schema.String, failure: CalendarFailure }),
]);

export const ListCalendarsOutput = Schema.Struct({
  accounts: Schema.Array(AccountCalendars),
});

export const ListEventsInput = Schema.Struct({
  calendars: Schema.Array(CalendarRef),
  range: Range,
});

export const ListEventsOutput = Schema.Struct({
  events: Schema.Array(CalendarEvent),
  versions: Schema.Array(
    Schema.Struct({ ...CalendarRef.fields, version: Schema.Int })
  ),
});

export const CreateEventInput = Schema.Struct({
  ...CalendarRef.fields,
  event: EventFields,
  id: ClientEventId,
  sendUpdates: Schema.optional(SendUpdates),
});

export const UpdateEventInput = Schema.Struct({
  ...EventRef.fields,
  changes: EventFields,
  removeRecurrence: Schema.optional(Schema.Literals([true])),
  scope: EditScope,
  sendUpdates: Schema.optional(SendUpdates),
});

export const MoveEventInput = Schema.Struct({
  ...EventRef.fields,
  destination: CalendarRef,
  sendUpdates: Schema.optional(SendUpdates),
});

export const DeleteEventInput = Schema.Struct({
  ...EventRef.fields,
  scope: EditScope,
  sendUpdates: Schema.optional(SendUpdates),
});

export const RsvpInput = Schema.Struct({
  ...EventRef.fields,
  note: Schema.optional(Schema.String),
  response: ResponseStatus,
  sendUpdates: Schema.optional(SendUpdates),
});

export const listCalendarsContract = defineContract("listCalendars", {
  annotations: { idempotent: true, readOnly: true },
  description: "List connected Google calendars and provider color palettes",
  failure: CalendarFailure,
  input: Schema.Struct({}),
  output: ListCalendarsOutput,
});

export const listEventsContract = defineContract("listEvents", {
  annotations: { idempotent: true, readOnly: true },
  description: "List Google-expanded instances overlapping a visible range",
  failure: CalendarReadFailure,
  input: ListEventsInput,
  output: ListEventsOutput,
});

export const getEventContract = defineContract("getEvent", {
  annotations: { idempotent: true, readOnly: true },
  description: "Read an event or recurring master on demand",
  failure: CalendarReadFailure,
  input: EventRef,
  output: CalendarEvent,
});

export const createEventContract = defineContract("createEvent", {
  annotations: { idempotent: true, readOnly: false },
  description: "Create an event with a stable client-generated base32hex id",
  failure: CalendarFailure,
  input: CreateEventInput,
  output: CalendarEvent,
});

export const updateEventContract = defineContract("updateEvent", {
  annotations: { idempotent: false, readOnly: false },
  description:
    "Edit one instance, the whole series, or split this and following instances",
  failure: CalendarFailure,
  input: UpdateEventInput,
  output: CalendarEvent,
});

export const moveEventContract = defineContract("moveEvent", {
  annotations: { idempotent: false, readOnly: false },
  description:
    "Move a whole event or series between calendars of the same account",
  failure: CalendarFailure,
  input: MoveEventInput,
  output: CalendarEvent,
});

export const deleteEventContract = defineContract("deleteEvent", {
  annotations: { destructive: true, idempotent: true, readOnly: false },
  description:
    "Remove one instance, the series, or this and following instances",
  failure: CalendarFailure,
  input: DeleteEventInput,
  output: Schema.Void,
});

export const rsvpContract = defineContract("rsvp", {
  annotations: { idempotent: true, readOnly: false },
  description: "Change only the authenticated attendee's response",
  failure: CalendarFailure,
  input: RsvpInput,
  output: CalendarEvent,
});

export const syncNowContract = defineContract("syncNow", {
  annotations: { idempotent: true, readOnly: false },
  description:
    "Advance one calendar's change cursor and invalidate changed ranges",
  failure: CalendarFailure,
  input: CalendarRef,
  output: SyncResult,
});

export const calendarContracts = [
  listCalendarsContract,
  listEventsContract,
  getEventContract,
  createEventContract,
  updateEventContract,
  moveEventContract,
  deleteEventContract,
  rsvpContract,
  syncNowContract,
] as const;

export {
  Attendee,
  Calendar,
  CalendarEvent,
  CalendarRef,
  ClientEventId,
  Colors,
  EditScope,
  EventFields,
  EventRef,
  EventTime,
  EventReminders,
  Reminder,
  Range,
  ResponseStatus,
  SendUpdates,
  WatchChannel,
} from "./model.js";

export { CalendarReadFailure } from "./calendar-read-failure.js";

export { equivalenceKey } from "./equivalence-key.js";

export {
  CalendarProviderCapabilities,
  googleCalendarCapabilities,
} from "./provider-capabilities.js";

export type { CalendarProviderCapabilitiesValue } from "./provider-capabilities.js";

export { CalendarChanged } from "./changes.js";

export type { CalendarChangedValue } from "./changes.js";

export type {
  CalendarEventValue,
  CalendarRefValue,
  CalendarValue,
  ColorsValue,
  EventFieldsValue,
  EventRefValue,
  EventTimeValue,
  EventRemindersValue,
  ReminderValue,
  RangeValue,
} from "./model.js";

export {
  CalendarFailure,
  Gone,
  NotConnected,
  NotFound,
  Provider,
  RateLimited,
  Revoked,
  UnsupportedRecurrenceSplit,
  CrossAccountMove,
  CalendarMoveRefused,
  ReminderLimitExceeded,
  RecurrenceRemovalRefused,
} from "./errors.js";
