import { implement } from "@calendar/capability/implement";

import { CalendarService } from "./calendar.js";
import {
  createEventContract,
  deleteEventContract,
  getEventContract,
  listCalendarsContract,
  listEventsContract,
  moveEventContract,
  rsvpContract,
  syncNowContract,
  updateEventContract,
} from "./contracts.js";
import { syncCalendar } from "./sync.js";

export const listCalendars = implement(listCalendarsContract, () =>
  CalendarService.use((calendar) => calendar.listCalendars())
);

export const listEvents = implement(listEventsContract, (input) =>
  CalendarService.use((calendar) => calendar.listEvents(input))
);

export const getEvent = implement(getEventContract, (input) =>
  CalendarService.use((calendar) => calendar.getEvent(input))
);

export const createEvent = implement(createEventContract, (input) =>
  CalendarService.use((calendar) => calendar.createEvent(input))
);

export const updateEvent = implement(updateEventContract, (input) =>
  CalendarService.use((calendar) => calendar.updateEvent(input))
);

export const moveEvent = implement(moveEventContract, (input) =>
  CalendarService.use((calendar) => calendar.moveEvent(input))
);

export const deleteEvent = implement(deleteEventContract, (input) =>
  CalendarService.use((calendar) => calendar.deleteEvent(input))
);

export const rsvp = implement(rsvpContract, (input) =>
  CalendarService.use((calendar) => calendar.rsvp(input))
);

export const syncNow = implement(syncNowContract, syncCalendar);

export const calendarCapabilities = [
  listCalendars,
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  moveEvent,
  deleteEvent,
  rsvp,
  syncNow,
] as const;
