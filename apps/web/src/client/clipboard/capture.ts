import { EventRef } from "@calendar/calendar/contracts";
import type {
  CalendarEventValue,
  EventTimeValue,
} from "@calendar/calendar/contracts";
import { DateTime, Option, Schema } from "effect";

import { editorDate } from "../../layout/editor-time.js";
import {
  ClipboardCaptureResult,
  ClipboardContent,
  ClipboardCreationFields,
  ClipboardGuest,
  ClipboardInputFailure,
  ClipboardItem,
  ClipboardRange,
} from "./model.js";

const capturedRange = (
  start: EventTimeValue | undefined,
  end: EventTimeValue | undefined
): Option.Option<typeof ClipboardRange.Type> => {
  if (start === undefined || end === undefined) {
    return Option.none();
  }

  if ("date" in start && "date" in end) {
    return editorDate(start.date).pipe(
      Option.flatMap((from) =>
        editorDate(end.date).pipe(
          Option.filter(
            (to) => DateTime.toEpochMillis(to) > DateTime.toEpochMillis(from)
          ),
          Option.map(() =>
            ClipboardRange.cases.AllDay.make({
              end: end.date,
              start: start.date,
            })
          )
        )
      )
    );
  }

  if ("dateTime" in start && "dateTime" in end) {
    if (
      Option.isNone(editorDate(start.dateTime.slice(0, 10))) ||
      Option.isNone(editorDate(end.dateTime.slice(0, 10)))
    ) {
      return Option.none();
    }

    return DateTime.make(start.dateTime).pipe(
      Option.flatMap((from) =>
        DateTime.make(end.dateTime).pipe(
          Option.filter(
            (to) => DateTime.toEpochMillis(to) > DateTime.toEpochMillis(from)
          ),
          Option.map((to) =>
            ClipboardRange.cases.Timed.make({
              end: DateTime.toEpochMillis(to),
              start: DateTime.toEpochMillis(from),
            })
          )
        )
      )
    );
  }

  return Option.none();
};

const capturedGuests = (
  event: CalendarEventValue,
  selfEmails: readonly string[]
): readonly (typeof ClipboardGuest.Type)[] => {
  const seen = new Set(selfEmails.map((email) => email.toLowerCase()));
  const guests: (typeof ClipboardGuest.Type)[] = [];

  for (const person of event.attendees ?? []) {
    const key = person.email.toLowerCase();

    if (person.self === true || seen.has(key)) {
      continue;
    }

    seen.add(key);
    guests.push(
      ClipboardGuest.make({
        displayName: person.displayName,
        email: person.email,
        optional: person.optional ?? false,
        resource: person.resource ?? false,
      })
    );
  }

  return guests;
};

export const captureClipboardItem = (
  event: CalendarEventValue,
  selfEmails: readonly string[]
): typeof ClipboardCaptureResult.Type => {
  const source = EventRef.make({
    accountId: event.accountId,
    calendarId: event.calendarId,
    eventId: event.eventId,
  });

  if (
    event.status === "cancelled" ||
    (event.eventType !== undefined && event.eventType !== "default")
  ) {
    return ClipboardCaptureResult.cases.Refused.make({
      failure: new ClipboardInputFailure({
        message:
          "Only an ordinary, non-cancelled event can be copied in this version.",
        reason: "unsupportedEvent",
        source,
      }),
    });
  }

  const range = capturedRange(event.start, event.end);

  const creationFields = Schema.decodeOption(ClipboardCreationFields)(event);

  if (Option.isNone(range) || Option.isNone(creationFields)) {
    return ClipboardCaptureResult.cases.Refused.make({
      failure: new ClipboardInputFailure({
        message:
          "This event has no supported, positive date or time range to copy.",
        reason: "invalidRange",
        source,
      }),
    });
  }

  return ClipboardCaptureResult.cases.Captured.make({
    item: ClipboardItem.make({
      content: ClipboardContent.make({
        colorId: event.colorId ?? null,
        description: event.description ?? "",
        location: event.location ?? "",
        reminders: {
          overrides: event.reminders?.overrides ?? [],
          useDefault: event.reminders?.useDefault ?? true,
        },
        title: event.title ?? "",
      }),
      creationFields: creationFields.value,
      guests: capturedGuests(event, selfEmails),
      guestsComplete: event.attendeesOmitted !== true,
      nativeConference:
        event.conferenceUrl !== undefined ||
        event.conferencingStatus !== undefined,
      range: range.value,
      recurring:
        event.recurringEventId !== undefined ||
        (event.recurrence?.length ?? 0) > 0,
      source,
    }),
  });
};
