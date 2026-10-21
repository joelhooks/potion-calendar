import { Effect } from "effect";

import type { WriteOptions } from "./google.js";
import { GoogleCalendarClient } from "./google.js";
import type { CalendarRefValue, EventFieldsValue } from "./model.js";
import { Provider } from "./provider.js";
import {
  hasCreateOnlyTypeFields,
  statusEventAvailability,
  statusEventType,
} from "./status-event.js";

export const validateEventTypeUpdate = (fields: EventFieldsValue) =>
  hasCreateOnlyTypeFields(fields)
    ? Effect.fail(
        new Provider({
          message:
            "Event type and status creation properties cannot be changed after creation in this app.",
          operation: "updateEvent",
          status: 0,
        })
      )
    : Effect.void;

type StatusCreateFacts = CalendarRefValue &
  WriteOptions & { readonly event: EventFieldsValue };

const invalidStatusFields = (input: StatusCreateFacts) => {
  const { event } = input;
  const focus = event.eventType === "focusTime";

  const properties = focus
    ? event.focusTimeProperties
    : event.outOfOfficeProperties;

  return (
    (properties?.autoDeclineMode !== "declineNone" &&
      properties?.autoDeclineMode !== "declineOnlyNewConflictingInvitations") ||
    properties.declineMessage !== undefined ||
    event.focusTimeProperties?.chatStatus !== undefined ||
    event.transparency !== "opaque" ||
    (event.attendees?.length ?? 0) > 0 ||
    input.sendUpdates !== "none" ||
    input.conferencingRequest !== undefined ||
    (focus ? event.outOfOfficeProperties : event.focusTimeProperties) !==
      undefined
  );
};

export const validateStatusEventCreate = Effect.fn("validateStatusEventCreate")(
  function* validateStatusEventCreate(input: StatusCreateFacts) {
    if (!statusEventType(input.event.eventType)) {
      if (
        input.event.focusTimeProperties !== undefined ||
        input.event.outOfOfficeProperties !== undefined
      ) {
        return yield* new Provider({
          message:
            "Status properties require a matching create-time event type.",
          operation: "createEvent",
          status: 0,
        });
      }

      return yield* Effect.void;
    }

    const calendar = yield* GoogleCalendarClient.use((google) =>
      google.getCalendar(input)
    );

    const allDay =
      input.event.start === undefined ||
      "date" in input.event.start ||
      input.event.end === undefined ||
      "date" in input.event.end;

    const availability = statusEventAvailability(calendar, allDay);

    if (availability.kind === "ineligible") {
      return yield* new Provider({
        message: availability.reason,
        operation: "createEvent",
        status: 0,
      });
    }

    if (invalidStatusFields(input)) {
      return yield* new Provider({
        message:
          "Status events require documented invitation behavior, busy time, no guests, and no invitation updates or conferencing.",
        operation: "createEvent",
        status: 0,
      });
    }

    return yield* Effect.void;
  }
);
