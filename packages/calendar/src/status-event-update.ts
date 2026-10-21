import { Effect } from "effect";

import type { UpdateEventInput } from "./contracts.js";
import { GoogleCalendarClient } from "./google.js";
import type { WriteOptions } from "./google.js";
import type { CalendarEventValue } from "./model.js";
import { Provider } from "./provider.js";
import {
  statusEventProperties,
  statusEventType,
  supportedStatusInvitationMode,
} from "./status-event.js";

const refused = (message: string) =>
  new Provider({ message, operation: "updateEvent", status: 0 });

const validPolicyChange = (
  source: CalendarEventValue,
  input: typeof UpdateEventInput.Type
) => {
  const properties = statusEventProperties({
    ...input.changes,
    eventType: source.eventType,
  });

  const other =
    source.eventType === "focusTime"
      ? input.changes.outOfOfficeProperties
      : input.changes.focusTimeProperties;

  return (
    statusEventType(source.eventType) &&
    supportedStatusInvitationMode(properties?.autoDeclineMode) &&
    other === undefined &&
    properties?.declineMessage === undefined &&
    input.changes.focusTimeProperties?.chatStatus === undefined &&
    (input.changes.attendees?.length ?? 0) === 0 &&
    input.sendUpdates === "none" &&
    input.conferencingRequest === undefined &&
    input.removeRecurrence !== true &&
    input.scope !== "allFollowing"
  );
};

export const statusEventUpdateOptions = Effect.fn("statusEventUpdateOptions")(
  function* statusEventUpdateOptions(
    source: CalendarEventValue,
    input: typeof UpdateEventInput.Type
  ) {
    const options: WriteOptions = {
      conferencingRequest: input.conferencingRequest,
      sendUpdates: input.sendUpdates,
    };

    if (
      input.changes.focusTimeProperties === undefined &&
      input.changes.outOfOfficeProperties === undefined
    ) {
      return options;
    }

    if (
      !supportedStatusInvitationMode(
        statusEventProperties(source)?.autoDeclineMode
      )
    ) {
      return yield* refused(
        "Google's saved invitation policy is read-only here. Change it in Google Calendar."
      );
    }

    if (!validPolicyChange(source, input)) {
      return yield* refused(
        "Change only the matching status invitation policy, for one event or the whole series, without guests, conferencing or invitation updates."
      );
    }

    const calendar = yield* GoogleCalendarClient.use((google) =>
      google.getCalendar(input)
    );

    if (
      calendar.accessRole !== "owner" ||
      !calendar.primary ||
      source.organizer?.self !== true
    ) {
      return yield* refused(
        "Only the owner can change this status invitation policy on their primary calendar."
      );
    }

    return {
      ...options,
      statusPropertyType:
        source.eventType === "focusTime" ? "focusTime" : "outOfOffice",
    } satisfies WriteOptions;
  }
);
