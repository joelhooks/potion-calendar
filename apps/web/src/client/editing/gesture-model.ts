import { CalendarEvent } from "@calendar/calendar/contracts";
import { Schema } from "effect";

export const GestureRange = Schema.Struct({
  allDay: Schema.Boolean,
  endDate: Schema.String,
  endTime: Schema.String,
  startDate: Schema.String,
  startTime: Schema.String,
});

export const GesturePoint = Schema.Struct({
  alt: Schema.Boolean,
  at: Schema.Finite,
  day: Schema.Int,
  minute: Schema.Finite,
  mod: Schema.optionalKey(Schema.Boolean),
  pointerId: Schema.Int,
  shift: Schema.Boolean,
  x: Schema.Finite,
  y: Schema.Finite,
});

export const GestureTarget = Schema.Struct({
  allDay: Schema.Boolean,
  editable: Schema.Boolean,
  end: Schema.Finite,
  event: CalendarEvent,
  key: Schema.String,
  start: Schema.Finite,
});

export const GestureStart = Schema.Struct({
  allDay: Schema.Boolean,
  edge: Schema.Literals(["body", "start", "end"]),
  point: GesturePoint,
  target: Schema.Option(GestureTarget),
});

export const GestureResult = Schema.Struct({
  allDayRow: Schema.Boolean,
  duplicate: Schema.Boolean,
  id: Schema.Int,
  intent: Schema.optionalKey(Schema.Literals(["ordinary", "noEmailGesture"])),
  range: GestureRange,
  target: Schema.Option(GestureTarget),
});
