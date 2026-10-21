import type {
  CalendarEventValue,
  CalendarValue,
} from "@calendar/calendar/contracts";

export const instantSourceEligible = (event: CalendarEventValue): boolean =>
  (event.eventType === undefined || event.eventType === "default") &&
  (event.recurringEventId !== undefined ||
    (event.recurrence?.length ?? 0) === 0);

export const instantEventEligible = (
  event: CalendarEventValue,
  calendar: CalendarValue | undefined
): boolean =>
  calendar !== undefined &&
  (calendar.accessRole === "owner" || calendar.accessRole === "writer") &&
  instantSourceEligible(event);
