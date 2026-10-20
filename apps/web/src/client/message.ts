import {
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
import { ReadFailure } from "./calendar-state.js";
import { ConferencingChange } from "./conferencing/model.js";
import { DesktopNotice, DesktopRequest } from "./desktop/model.js";
import { EditorAction } from "./editing/editor-action.js";
import { GestureResult } from "./editing/gesture-model.js";
import { EditingNotice } from "./editing/runtime.js";
import { LiveNotice } from "./live/protocol.js";
import {
  NotificationEvent,
  NotificationFailure,
  PermissionOutcome,
} from "./reminders/model.js";
import { SearchNotice, SearchProblem } from "./search/model.js";
import { ManagementChange } from "./settings-management/model.js";
import { SavedPreferences, SettingsChange } from "./settings/model.js";
import { TimeZoneAction } from "./time-zones/model.js";

export const Message = defineMessageUnion({
  BrowserUrlChanged: { url: Url },
  BrowserUrlRequested: { request: UrlRequest },
  CalendarChanged: {},
  ChangedConferencing: { change: ConferencingChange },
  ChangedSettings: { change: SettingsChange },
  ChangedSettingsManagement: { change: ManagementChange },
  ClickedAddGoogle: {},
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
  ClosedDetail: {},
  CompletedGesture: {
    gesture: GestureResult,
    hostKey: Schema.optionalKey(Schema.String),
    personId: Schema.String,
  },
  CompletedGridScroll: {},
  CycledTheme: {},
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
  KeyboardDate: { day: Schema.Int, flash: Schema.optional(Schema.Boolean) },
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
  Navigated: {},
  ObservedNotification: { event: NotificationEvent, now: Schema.Finite },
  PageHidden: {},
  PreparedGestureHost: { hostKey: Schema.String },
  PreparedGestureTargets: {},
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
  ReceivedCalendars: {
    personId: Schema.optionalKey(Schema.String),
    result: ListCalendarsOutput,
  },
  ReceivedDesktop: { notice: DesktopNotice },
  ReceivedEditing: { notice: EditingNotice, personId: Schema.String },
  ReceivedEvents: {
    accountId: Schema.String,
    request: Schema.Int,
    result: ListEventsOutput,
  },
  ReceivedLive: { notice: LiveNotice, personId: Schema.String },
  ReceivedPreferences: { person: Schema.String, preferences: SavedPreferences },
  ReceivedSearch: { notice: SearchNotice },
  ReceivedSession: { snapshot: SessionSnapshot },
  ReceivedSystemSettings: { dark: Schema.Boolean, hour24: Schema.Boolean },
  ReceivedUpcoming: {
    personId: Schema.String,
    request: Schema.Int,
    result: ListEventsOutput,
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
  RequestedJoinMeeting: { key: Schema.Option(AgendaKey) },
  RequestedRoute: { replace: Schema.Boolean, route: Route },
  RequestedRouteBack: {},
  SavedPreferences: {},
  SearchBlur: {},
  SearchClear: {},
  SearchContext: { key: Schema.String },
  SearchContextClose: {},
  SearchEscape: {},
  SearchInput: { text: Schema.String },
  SearchOpened: { query: Schema.Option(Schema.String) },
  SearchPrefetchFailed: {
    personId: Schema.String,
    problem: SearchProblem,
    revision: Schema.Int,
  },
  SearchScroll: { position: Schema.Finite },
  SearchSelect: { goTo: Schema.Boolean, key: Schema.String },
  Ticked: { now: Schema.Finite },
  TimeZoneAction: { action: TimeZoneAction },
});

export type AppMessage = typeof Message.Type;
