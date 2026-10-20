import type { CalendarValue } from "@calendar/calendar/contracts";
import { Match } from "effect";

import { readFailure } from "../client/calendar-state.js";
import type { MutationFailureValue } from "../client/editing/failure.js";

const movedCalendar = (
  event: { readonly accountId: string; readonly calendarId: string },
  calendars: readonly CalendarValue[]
): string =>
  calendars.find(
    (calendar) =>
      calendar.accountId === event.accountId &&
      calendar.calendarId === event.calendarId
  )?.title ?? "the destination calendar";

export const mutationFailureMessage = (
  failure: MutationFailureValue,
  calendars: readonly CalendarValue[] = []
): string =>
  Match.value(failure).pipe(
    Match.tag(
      "UnsupportedRecurrenceSplit",
      () =>
        "This recurring split is not supported. No alternate scope was used."
    ),
    Match.tag("SeriesMoveRetimePartial", (value) =>
      value.retimeOutcome === "rejected"
        ? `Moved to ${movedCalendar(value.movedEvent, calendars)}, but the time wasn't changed. Check the event and set the time again.`
        : `Moved to ${movedCalendar(value.movedEvent, calendars)}. We couldn't confirm the time change. Your calendars are refreshing; check the event before editing it again.`
    ),
    Match.tag(
      "SeriesMoveRetimeUncertain",
      () =>
        "We couldn't confirm the move. Your calendars are refreshing; check the event before editing it again."
    ),
    Match.tag(
      "MutationFollowupPartial",
      (value) =>
        `Moved to ${movedCalendar(value.movedEvent, calendars)}. Additional changes couldn't be confirmed. Your calendars are refreshing; check the event before editing it again.`
    ),
    Match.tag(
      "SeriesMoveRetimeRefused",
      () =>
        "This series cannot be moved and retimed together. No alternate scope was used."
    ),
    Match.tag("ConferencingRefused", (value) =>
      Match.value(value.reason).pipe(
        Match.when(
          "calendarReadOnly",
          () => "This calendar does not permit conferencing changes."
        ),
        Match.when(
          "calendarUnsupported",
          () => "This calendar does not support creating Google Meet."
        ),
        Match.when(
          "eventTypeUnsupported",
          () => "Google Meet is not available for this event type."
        ),
        Match.when(
          "existingConferenceUnrepresentable",
          () =>
            "Conferencing could not be preserved for this and following events. Neither series was changed. Make this change in Google Calendar."
        ),
        Match.exhaustive
      )
    ),
    Match.tag("MutationFeatureUnavailable", (value) => value.message),
    Match.tag("MutationTransportFailure", (value) => value.message),
    Match.tag("CalendarReadFailure", (value) => readFailure(value).message),
    Match.tag(
      "Revoked",
      "NotConnected",
      () => "Reconnect this Google account before trying again."
    ),
    Match.orElse(
      () =>
        "Google could not complete the change. Review the current event before retrying."
    )
  );
