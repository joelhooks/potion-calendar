import { DateTime, Option } from "effect";
import { AsyncData } from "foldkit";

import type { AppModel } from "../app.js";
import { upcomingSelection } from "../upcoming/update.js";
import { acceptedReminderCandidates } from "./accepted-candidates.js";
import type { ReminderScan } from "./model.js";
import { reminderSnoozeLookback } from "./snooze-lookback.js";

export const reminderSnapshot = (
  model: AppModel
): typeof ReminderScan.Type | undefined => {
  if (Option.isNone(model.person)) {
    return undefined;
  }

  const saved = AsyncData.getData(model.upcoming.data);

  const lookback = reminderSnoozeLookback(
    model.reminders.context,
    model.calendar.now
  );

  const query = Option.getOrUndefined(model.upcoming.query);
  const accepted = Option.getOrUndefined(model.upcoming.accepted);

  const snoozeRangeReady =
    Option.isNone(lookback) ||
    (query === undefined && AsyncData.isSuccess(model.upcoming.data)) ||
    (query !== undefined &&
      accepted?.request === query.request &&
      DateTime.toEpochMillis(DateTime.makeUnsafe(query.range.start)) <=
        lookback.value);

  return {
    accepted: Option.isSome(saved) ? model.upcoming.accepted : Option.none(),
    candidates: acceptedReminderCandidates(model),
    eventInvites: model.settings.eventInvites,
    now: model.calendar.now,
    personId: model.person.value,
    scope: JSON.stringify([model.person.value, upcomingSelection(model)]),
    snoozeRangeReady,
  };
};
