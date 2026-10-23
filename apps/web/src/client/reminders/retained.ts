import type { CalendarEventValue, Range } from "@calendar/calendar/contracts";
import { DateTime } from "effect";

import type { AppModel } from "../app.js";
import { eventKey } from "../calendar-state.js";
import { acceptedReminderCandidates } from "./accepted-candidates.js";
import {
  liveSnoozeIdentities,
  reminderEventIdentity,
} from "./snooze-identities.js";

export const retainedReminderEvents = (
  model: AppModel,
  returned: readonly CalendarEventValue[],
  range: typeof Range.Type
): readonly CalendarEventValue[] => {
  const live = liveSnoozeIdentities(model.reminders.context);
  const replaced = new Set(returned.map(reminderEventIdentity));
  const replacedKeys = new Set(returned.map(eventKey));
  const start = DateTime.toEpochMillis(DateTime.makeUnsafe(range.start));
  const end = DateTime.toEpochMillis(DateTime.makeUnsafe(range.end));

  return acceptedReminderCandidates(model)
    .filter(
      (candidate) =>
        live.has(candidate.identity) &&
        !replaced.has(candidate.identity) &&
        !replacedKeys.has(eventKey(candidate.event)) &&
        (candidate.end <= start || candidate.start >= end)
    )
    .map((candidate) => candidate.event);
};

export const releaseResolvedReminderEvents = (model: AppModel): AppModel => {
  const retained = model.upcoming.reminderEvents ?? [];
  const live = liveSnoozeIdentities(model.reminders.context);

  const remaining = retained.filter((event) =>
    live.has(reminderEventIdentity(event))
  );

  return remaining.length === retained.length
    ? model
    : {
        ...model,
        upcoming: { ...model.upcoming, reminderEvents: remaining },
      };
};
