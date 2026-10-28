import { defineContract } from "@calendar/capability/contract";
import { Schema } from "effect";

import { CalendarReadFailure } from "./calendar-read-failure.js";
import {
  getAccountConferencingDefaultContract,
  setAccountConferencingDefaultContract,
} from "./conferencing-contracts.js";
import { ConferencingRequest } from "./conferencing-model.js";
import {
  readCustomVideoLinksContract,
  importCustomVideoLinksContract,
  saveCustomVideoLinkContract,
  removeCustomVideoLinkContract,
} from "./custom-video-link-contracts.js";
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
  EventTime,
  Range,
  ResponseStatus,
  SendUpdates,
} from "./model.js";
import { ReadNeighborOccurrenceInput } from "./occurrence-model.js";
import { SearchEventsInput, SearchEventsOutput } from "./search-model.js";
import { SeriesMoveRetimeFailure } from "./series-move-result.js";
import {
  disconnectAccountContract,
  setCalendarAppearanceContract,
} from "./settings-contracts.js";
import { SyncResult } from "./sync-result.js";

export {
  CustomVideoCatalog,
  CustomVideoFailure,
  ImportCustomVideoLinksInput,
  SaveCustomVideoLinkInput,
  RemoveCustomVideoLinkInput,
  readCustomVideoLinksContract,
  importCustomVideoLinksContract,
  saveCustomVideoLinkContract,
  removeCustomVideoLinkContract,
} from "./custom-video-link-contracts.js";

export {
  CustomVideoLink,
  CustomVideoLinks,
  CustomVideoReference,
  customVideoReference,
} from "./custom-video-link.js";

export {
  OccurrenceDirection,
  ReadNeighborOccurrenceInput,
} from "./occurrence-model.js";

export type { ReadNeighborOccurrenceInputValue } from "./occurrence-model.js";

export {
  getAccountConferencingDefaultContract,
  setAccountConferencingDefaultContract,
  GetAccountConferencingDefaultInput,
  SetAccountConferencingDefaultInput,
  AccountConferencingDefault,
  AccountConferencingDefaultFailure,
} from "./conferencing-contracts.js";

export {
  ConferencingRequest,
  ConferencingDefault,
  ConferencingStatus,
} from "./conferencing-model.js";

export type { ConferencingRequestValue } from "./conferencing-model.js";

export { OwnedConference, ConferenceEntryPoint } from "./owned-conference.js";

export type { OwnedConferenceValue } from "./owned-conference.js";

export {
  disconnectAccountInstruction,
  disconnectAccountContract,
  setCalendarAppearanceContract,
  DisconnectAccountInput,
  DisconnectAccountResult,
  DisconnectAccountFailure,
  CalendarAppearancePatch,
  SetCalendarAppearanceInput,
  SetCalendarAppearanceFailure,
} from "./settings-contracts.js";

export { AccountNotOwned } from "./account-not-owned.js";

export { LastCalendarAccount } from "./last-calendar-account.js";

export { CalendarAppearanceRefused } from "./calendar-appearance-refused.js";

export {
  exportIcsCalendar,
  IcsExportOutcome,
  IcsSkippedEvent,
} from "./ical-export.js";

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

export {
  statusEventAvailability,
  statusEventLabel,
  statusEventProperties,
  supportedStatusInvitationMode,
  statusEventType,
} from "./status-event.js";

export const CreateEventInput = Schema.Struct({
  ...CalendarRef.fields,
  conferencingRequest: Schema.optional(ConferencingRequest),
  event: EventFields,
  id: ClientEventId,
  sendUpdates: Schema.optional(SendUpdates),
});

export const UpdateEventInput = Schema.Struct({
  ...EventRef.fields,
  changes: EventFields,
  conferencingRequest: Schema.optional(ConferencingRequest),
  removeRecurrence: Schema.optional(Schema.Literals([true])),
  scope: EditScope,
  sendUpdates: Schema.optional(SendUpdates),
});

export const MoveEventInput = Schema.Struct({
  ...EventRef.fields,
  destination: CalendarRef,
  sendUpdates: Schema.optional(SendUpdates),
});

export const MoveAndRetimeSeriesInput = Schema.Struct({
  ...EventRef.fields,
  destination: CalendarRef,
  end: EventTime,
  sendUpdates: Schema.optional(SendUpdates),
  start: EventTime,
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

export const searchEventsContract = defineContract("searchEvents", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "Initial Google q search of owned/subscribed calendars, including hidden ones. Split at local week start four weeks ago; forward end includes the local day three years after that boundary. Pages are limited to 100 forward and 2500 older; no pagination or completeness claim. Per-calendar failures preserve other calendars.",
  failure: CalendarFailure,
  input: SearchEventsInput,
  output: SearchEventsOutput,
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

export const moveAndRetimeSeriesContract = defineContract(
  "moveAndRetimeSeries",
  {
    annotations: { idempotent: false, readOnly: false },
    description:
      "Move a recurring series using offset timestamps; preserve its master's local date and report partial or uncertain outcomes",
    failure: SeriesMoveRetimeFailure,
    input: MoveAndRetimeSeriesInput,
    output: CalendarEvent,
  }
);

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

export const readNeighborOccurrenceContract = defineContract(
  "readNeighborOccurrence",
  {
    annotations: { idempotent: true, readOnly: true },
    description:
      "Read the nearest uncancelled instance in one owned recurring series; incomplete scans fail rather than report absence",
    failure: CalendarReadFailure,
    input: ReadNeighborOccurrenceInput,
    output: Schema.NullOr(CalendarEvent),
  }
);

export const calendarContracts = [
  readCustomVideoLinksContract,
  importCustomVideoLinksContract,
  saveCustomVideoLinkContract,
  removeCustomVideoLinkContract,
  getAccountConferencingDefaultContract,
  setAccountConferencingDefaultContract,
  disconnectAccountContract,
  setCalendarAppearanceContract,
  listCalendarsContract,
  listEventsContract,
  searchEventsContract,
  getEventContract,
  readNeighborOccurrenceContract,
  createEventContract,
  updateEventContract,
  moveEventContract,
  moveAndRetimeSeriesContract,
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

export {
  SeriesMoveRetimeFailure,
  SeriesMoveRetimeRefused,
  SeriesMoveRetimePartial,
  SeriesMoveRetimeUncertain,
} from "./series-move-result.js";

export type { SeriesMoveRetimeFailureValue } from "./series-move-result.js";

export {
  SearchEventsInput,
  SearchEventsOutput,
  SearchEventResult,
  SearchWindow,
  SearchOlderCursor,
  SearchPageTarget,
  SearchContinuation,
} from "./search-model.js";

export type {
  SearchEventsInputValue,
  SearchEventsOutputValue,
  SearchEventResultValue,
} from "./search-model.js";

export {
  matchesLocalSearch,
  orderSearchResults,
  searchEventResult,
} from "./search-results.js";

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
  ConferencingRefused,
} from "./errors.js";
