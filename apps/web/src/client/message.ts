import {
  ListCalendarsOutput,
  ListEventsOutput,
} from "@calendar/calendar/contracts";
import { SessionSnapshot } from "@calendar/core/contracts";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";

import { NavigationState } from "../layout/navigation.js";
import { ReadFailure } from "./calendar-state.js";

export const Message = defineMessageUnion({
  CalendarChanged: {},
  ClickedAddGoogle: {},
  ClickedAllDay: {},
  ClickedCalendar: { accountId: Schema.String, calendarId: Schema.String },
  ClickedDate: { day: Schema.Int },
  ClickedDeclined: {},
  ClickedEvent: { key: Schema.String },
  ClickedMergeDuplicates: {},
  ClickedPage: { direction: Schema.Literals([-1, 1]) },
  ClickedRetry: { accountId: Schema.String },
  ClickedSignIn: {},
  ClickedSignOut: {},
  ClickedToday: {},
  ClickedView: {
    days: Schema.Int.check(Schema.isBetween({ maximum: 9, minimum: 1 })),
    mode: NavigationState.fields.mode,
  },
  ClickedWeekends: {},
  ClickedZoom: { step: Schema.Int },
  ClosedDetail: {},
  CompletedGridScroll: {},
  FailedAuth: {},
  FailedCalendars: { failure: ReadFailure },
  FailedEvents: {
    accountId: Schema.String,
    failure: ReadFailure,
    request: Schema.Int,
  },
  FailedPreferences: {},
  FailedSession: {},
  MeasuredViewport: {
    gutter: Schema.Finite,
    height: Schema.Finite,
    width: Schema.Finite,
  },
  Navigated: {},
  PressedCalendarKey: {
    alt: Schema.Boolean,
    key: Schema.String,
    mod: Schema.Boolean,
    shift: Schema.Boolean,
  },
  ReceivedCalendars: { result: ListCalendarsOutput },
  ReceivedEvents: {
    accountId: Schema.String,
    request: Schema.Int,
    result: ListEventsOutput,
  },
  ReceivedPreferences: {
    hidden: Schema.Array(Schema.String),
    mergeDuplicates: Schema.Boolean,
  },
  ReceivedSession: { snapshot: SessionSnapshot },
  SavedPreferences: {},
  Ticked: { now: Schema.Finite },
});

export type AppMessage = typeof Message.Type;
