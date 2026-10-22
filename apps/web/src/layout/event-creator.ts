import type { CalendarEventValue } from "@calendar/calendar/contracts";

export const creatorPresentation = (event: CalendarEventValue) => {
  const email = event.creator?.email?.trim().toLowerCase();
  const organizer = event.organizer?.email?.trim().toLowerCase();

  if (
    email === undefined ||
    email === "" ||
    organizer === undefined ||
    organizer === "" ||
    email === organizer
  ) {
    return { attendee: undefined, byline: undefined };
  }

  const attendee = event.attendees?.find(
    (person) => person.email.trim().toLowerCase() === email
  );

  const name = event.creator?.displayName;

  return {
    attendee,
    byline:
      attendee === undefined
        ? `Created by ${(name?.trim().length ?? 0) > 0 ? name : event.creator?.email}`
        : undefined,
  };
};
