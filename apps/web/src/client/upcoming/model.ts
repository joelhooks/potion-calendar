import {
  CalendarEvent,
  CalendarRef,
  Range,
} from "@calendar/calendar/contracts";
import { Option, Schema } from "effect";

import { RemoteEvents } from "../calendar-state.js";

export const upcomingRefreshMilliseconds = 5 * 60_000;

export const upcomingHorizonMilliseconds = 30 * 24 * 60 * 60_000;

export const UpcomingReceipt = Schema.Struct({
  origin: Schema.Literals(["snapshot", "live"]),
  request: Schema.Int,
});

export const UpcomingQuery = Schema.Struct({
  ...UpcomingReceipt.fields,
  calendars: Schema.Array(CalendarRef),
  personId: Schema.String,
  range: Range,
});

export const Upcoming = Schema.Struct({
  accepted: Schema.Option(UpcomingReceipt),
  data: RemoteEvents.schema,
  deferredRefresh: Schema.Option(UpcomingReceipt.fields.origin),
  query: Schema.Option(UpcomingQuery),
  refreshAt: Schema.Finite,
  reminderEvents: Schema.optional(Schema.Array(CalendarEvent)),
  request: Schema.Int,
});

export type UpcomingReceiptValue = typeof UpcomingReceipt.Type;

export type UpcomingValue = typeof Upcoming.Type;

export type UpcomingQueryValue = typeof UpcomingQuery.Type;

export const initialUpcoming = (request = 0): UpcomingValue => ({
  accepted: Option.none(),
  data: RemoteEvents.Idle(),
  deferredRefresh: Option.none(),
  query: Option.none(),
  refreshAt: 0,
  reminderEvents: [],
  request,
});
