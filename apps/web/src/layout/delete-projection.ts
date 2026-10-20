import type {
  CalendarEventValue,
  EventTimeValue,
} from "@calendar/calendar/contracts";
import { DateTime, Option } from "effect";

import type { DeleteIntentValue } from "../client/editing/delete-actor.js";

const anchor = (time: EventTimeValue | undefined): Option.Option<number> => {
  if (time === undefined) {
    return Option.none();
  }

  return DateTime.make("date" in time ? time.date : time.dateTime).pipe(
    Option.map(DateTime.toEpochMillis)
  );
};

export const deletionAffectsEvent = (
  intent: DeleteIntentValue,
  event: CalendarEventValue
): boolean => {
  if (
    intent.request.accountId !== event.accountId ||
    intent.request.calendarId !== event.calendarId
  ) {
    return false;
  }

  if (intent.event.eventId === event.eventId) {
    return true;
  }

  if (intent.request.scope === "single") {
    return false;
  }

  const series = intent.event.recurringEventId ?? intent.event.eventId;

  if (event.eventId !== series && event.recurringEventId !== series) {
    return false;
  }

  if (intent.request.scope === "all") {
    return true;
  }

  const from = anchor(
    intent.event.recurringEventId === undefined
      ? intent.event.start
      : intent.event.originalStartTime
  );

  const candidate = anchor(event.originalStartTime);

  return (
    Option.isSome(from) &&
    Option.isSome(candidate) &&
    candidate.value >= from.value
  );
};

export const projectPendingDeletes = (
  events: readonly CalendarEventValue[],
  intents: readonly DeleteIntentValue[]
): readonly CalendarEventValue[] =>
  events.filter(
    (event) => !intents.some((intent) => deletionAffectsEvent(intent, event))
  );
