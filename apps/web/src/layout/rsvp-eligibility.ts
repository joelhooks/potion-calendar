import { statusEventType } from "@calendar/calendar/contracts";
import type { CalendarEventValue } from "@calendar/calendar/contracts";

export const rsvpSelf = (event: CalendarEventValue) =>
  statusEventType(event.eventType)
    ? undefined
    : event.attendees?.find((person) => person.self === true);
