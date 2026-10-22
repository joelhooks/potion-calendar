import {
  CalendarRef,
  ListCalendarsOutput,
  ListEventsOutput,
} from "@calendar/calendar/contracts";
import { SessionSnapshot } from "@calendar/core/contracts";
import { AgendaKey, MeetingJoinOutcome } from "@calendar/core/desktop-bridge";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { UrlRequest } from "foldkit/navigation";
import { Url } from "foldkit/url";

import { NavigationState, maximumDisplayedDays } from "../layout/navigation.js";
import { Route } from "../layout/route.js";
import { SelectionBox, SelectionSet } from "../layout/selection-set.js";
import { AttachmentReadResult } from "./attachments/model.js";
import { ReadFailure } from "./calendar-state.js";
import { ClipboardDelivery } from "./clipboard/delivery.js";
import { ClipboardAction } from "./clipboard/runtime.js";
import { ConferencingChange } from "./conferencing/model.js";
import { DesktopNotice, DesktopRequest } from "./desktop/model.js";
import { EditorAction } from "./editing/editor-action.js";
import { GestureResult } from "./editing/gesture-model.js";
import { EditingNotice } from "./editing/runtime.js";
import { IcsExportNotice } from "./ics-export/model.js";
import { LiveNotice } from "./live/protocol.js";
import { MonthGestureRefused } from "./month/gesture.js";
import { MonthNotice } from "./month/model.js";
import {
  NotificationEvent,
  NotificationFailure,
  PermissionOutcome,
  ReminderCardAction,
} from "./reminders/model.js";
import { SearchNotice, SearchProblem } from "./search/model.js";
import { OccurrenceNotice } from "./selection-commands/model.js";
import { ManagementChange } from "./settings-management/model.js";
import { ConferencingSettingsChange } from "./settings/conferencing/model.js";
import { SavedPreferences, SettingsChange } from "./settings/model.js";
import { TimeBlockAction } from "./time-blocks/model.js";
import { TimeZoneAction } from "./time-zones/model.js";
import { ZoneDragPreview } from "./zone-drag/model.js";

export const Message = defineMessageUnion({
  BrowserUrlChanged: { url: Url },
  BrowserUrlRequested: { request: UrlRequest },
  BulkControl: {
    control: Schema.Literals(["undo", "dismiss"]),
    personId: Schema.optional(Schema.String),
  },
  CalendarChanged: {},
  ChangedConferencing: { change: ConferencingChange },
  ChangedConferencingSettings: {
    change: ConferencingSettingsChange,
    personId: Schema.String,
  },
  ChangedSettings: { change: SettingsChange },
  ChangedSettingsManagement: { change: ManagementChange },
  ChangedTimeBlocks: { action: TimeBlockAction, personId: Schema.String },
  ClickedAddGoogle: {},
  ClickedAlignToday: {},
  ClickedAllDay: {},
  ClickedCalendar: { accountId: Schema.String, calendarId: Schema.String },
  ClickedDate: { day: Schema.Int },
  ClickedDeclined: {},
  ClickedEnableReminders: {},
  ClickedEvent: { key: Schema.String },
  ClickedMergeDuplicates: {},
  ClickedPage: { direction: Schema.Literals([-1, 1]) },
  ClickedRefresh: {},
  ClickedRetry: { accountId: Schema.String },
  ClickedSignIn: {},
  ClickedSignOut: {},
  ClickedToday: {},
  ClickedView: {
    days: Schema.Int.check(
      Schema.isBetween({ maximum: maximumDisplayedDays, minimum: 1 })
    ),
    mode: NavigationState.fields.mode,
  },
  ClickedWeekends: {},
  ClickedZoom: { step: Schema.Int },
  ClipboardAction: {
    action: ClipboardAction,
    personId: Schema.String,
    sessionId: Schema.String,
  },
  ClosedDetail: {},
  CompletedGesture: {
    gesture: GestureResult,
    hostKey: Schema.optionalKey(Schema.String),
    personId: Schema.String,
  },
  CompletedGridScroll: {},
  CompletedMonthRead: {},
  CycledTheme: {},
  DismissedGestureRefusal: { personId: Schema.String },
  DismissedIcsExport: { personId: Schema.String, revision: Schema.Int },
  DispatchedClipboard: {},
  DispatchedEditing: {},
  EditingAction: {
    action: EditorAction,
    personId: Schema.optional(Schema.String),
  },
  FailedAuth: {},
  FailedCalendars: {
    failure: ReadFailure,
    personId: Schema.optionalKey(Schema.String),
  },
  FailedClipboard: {
    message: Schema.String,
    personId: Schema.String,
    sessionId: Schema.String,
  },
  FailedEditing: { message: Schema.String },
  FailedEvents: {
    accountId: Schema.String,
    failure: ReadFailure,
    request: Schema.Int,
  },
  FailedPreferenceSave: { person: Schema.String },
  FailedPreferences: { person: Schema.String },
  FailedSession: {},
  FailedUpcoming: {
    failure: ReadFailure,
    personId: Schema.String,
    request: Schema.Int,
  },
  FinishedJoinMeeting: { outcome: MeetingJoinOutcome, personId: Schema.String },
  KeyboardAction: { id: Schema.String },
  KeyboardClose: {},
  KeyboardDate: {
    day: Schema.Int,
    flash: Schema.optional(Schema.Boolean),
    revealSelection: Schema.optional(Schema.Boolean),
  },
  KeyboardHighlight: { id: Schema.String },
  KeyboardMove: { direction: Schema.Literals([-1, 1]) },
  KeyboardPick: { id: Schema.String },
  KeyboardQuery: { query: Schema.String },
  KeyboardResetSequence: {},
  KeyboardReturn: {},
  MeasuredViewport: {
    gutter: Schema.Finite,
    height: Schema.Finite,
    width: Schema.Finite,
  },
  ModifiedEventSelection: {
    hostKey: Schema.String,
    key: Schema.String,
    mod: Schema.Boolean,
    personId: Schema.String,
    shift: Schema.Boolean,
  },
  Navigated: {},
  ObservedNotification: { event: NotificationEvent, now: Schema.Finite },
  PageHidden: {},
  PreparedGestureHost: { hostKey: Schema.String },
  PreparedGestureTargets: {},
  PreparedSelection: {},
  PreparedZoneDragHost: { hostKey: Schema.String },
  PressedCalendarKey: {
    alt: Schema.Boolean,
    key: Schema.String,
    mod: Schema.Boolean,
    now: Schema.optional(Schema.Finite),
    shift: Schema.Boolean,
  },
  PreviewedGesture: {
    hostKey: Schema.optionalKey(Schema.String),
    personId: Schema.String,
    phase: Schema.optionalKey(Schema.Literals(["idle", "armed", "dragging"])),
    preview: Schema.Option(GestureResult),
  },
  PreviewedSelectionRectangle: {
    box: Schema.Option(SelectionBox),
    hostKey: Schema.String,
    personId: Schema.String,
  },
  PreviewedZoneDrag: {
    hostKey: Schema.String,
    preview: Schema.Option(ZoneDragPreview),
  },
  ReceivedCalendars: {
    personId: Schema.optionalKey(Schema.String),
    result: ListCalendarsOutput,
  },
  ReceivedClipboard: { delivery: ClipboardDelivery },
  ReceivedDesktop: { notice: DesktopNotice },
  ReceivedEditing: { notice: EditingNotice, personId: Schema.String },
  ReceivedEventAttachments: { result: AttachmentReadResult },
  ReceivedEvents: {
    accountId: Schema.String,
    request: Schema.Int,
    result: ListEventsOutput,
  },
  ReceivedIcsExport: { notice: IcsExportNotice },
  ReceivedLive: { notice: LiveNotice, personId: Schema.String },
  ReceivedMonth: { notice: MonthNotice },
  ReceivedOccurrence: { notice: OccurrenceNotice },
  ReceivedPreferences: { person: Schema.String, preferences: SavedPreferences },
  ReceivedSearch: { notice: SearchNotice },
  ReceivedSession: { snapshot: SessionSnapshot },
  ReceivedSystemSettings: { dark: Schema.Boolean, hour24: Schema.Boolean },
  ReceivedUpcoming: {
    personId: Schema.String,
    request: Schema.Int,
    result: ListEventsOutput,
  },
  RefusedGesture: {
    hostKey: Schema.String,
    personId: Schema.String,
    reason: MonthGestureRefused.fields.reason,
  },
  ReminderCardAction: {
    action: ReminderCardAction,
    id: Schema.String,
    personId: Schema.String,
  },
  ReminderDeliveryCompleted: {
    failure: Schema.Option(NotificationFailure),
    id: Schema.String,
    personId: Schema.String,
  },
  ReminderEffectCompleted: {},
  ReminderPermissionCompleted: {
    now: Schema.Finite,
    outcome: PermissionOutcome,
    personId: Schema.String,
  },
  RequestedDesktop: { request: DesktopRequest },
  RequestedEmailParticipants: {},
  RequestedIcsExport: {},
  RequestedJoinMeeting: { key: Schema.Option(AgendaKey) },
  RequestedRoute: { replace: Schema.Boolean, route: Route },
  RequestedRouteBack: {},
  ResumedFromBackground: { now: Schema.Finite },
  SavedPreferences: {},
  SearchBlur: {},
  SearchClear: {},
  SearchContext: { key: Schema.String },
  SearchContextClose: {},
  SearchEscape: {},
  SearchInput: { text: Schema.String },
  SearchMore: {},
  SearchOpened: { query: Schema.Option(Schema.String) },
  SearchPrefetchFailed: {
    personId: Schema.String,
    problem: SearchProblem,
    revision: Schema.Int,
  },
  SearchRetry: {},
  SearchRetryCalendar: CalendarRef.fields,
  SearchRetryMore: {},
  SearchScroll: { position: Schema.Finite },
  SearchSelect: { goTo: Schema.Boolean, key: Schema.String },
  SelectedRectangle: {
    hostKey: Schema.String,
    keys: SelectionSet,
    personId: Schema.String,
  },
  Ticked: { now: Schema.Finite },
  TimeZoneAction: { action: TimeZoneAction },
});

export type AppMessage = typeof Message.Type;
