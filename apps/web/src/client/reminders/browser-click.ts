import { Option, Predicate } from "effect";

import { dayFromIso, dayInZone, visibleDays } from "../../layout/navigation.js";
import type { AppModel, update } from "../app.js";
import { eventKey } from "../calendar-state.js";
import type { AppMessage } from "../message.js";
import { currentReminderCard } from "./card-selection.js";
import { reminderSnoozeOperationIdentity } from "./model.js";
import type { NotificationContentValue } from "./model.js";
import { selectReminderNotification } from "./selection.js";

type Result = ReturnType<typeof update>;

export const selectBrowserReminder = (
  model: AppModel,
  notification: NotificationContentValue,
  apply: (model: AppModel, message: AppMessage) => Result
): Result => {
  if (
    !Option.contains(model.person, notification.personId) ||
    model.desktop.availability !== "unavailable"
  ) {
    return { model };
  }

  const active = model.reminders.context.active.find(
    (entry) =>
      entry.personId === notification.personId &&
      entry.id === notification.id &&
      entry.card?.state === "active"
  );

  if (
    active === undefined ||
    active.candidate.identity !== notification.candidate.identity ||
    active.candidate.start !== notification.candidate.start ||
    Option.contains(
      reminderSnoozeOperationIdentity(model.reminders.context.snoozeStorage),
      active.candidate.identity
    )
  ) {
    return { model };
  }

  const current = currentReminderCard(
    model,
    notification.personId,
    notification.id
  );

  if (current === undefined) {
    return {
      model: {
        ...model,
        reminders: {
          ...model.reminders,
          failure: Option.some("This reminder’s event is no longer available."),
        },
      },
    };
  }

  const key = model.calendar.mergeDuplicates
    ? current.candidate.key
    : eventKey(current.candidate.event);

  const day =
    current.candidate.event.start !== undefined &&
    "date" in current.candidate.event.start
      ? dayFromIso(current.candidate.event.start.date)
      : dayInZone(current.candidate.start, model.calendar.zone);

  if (
    Predicate.isTagged(model.route, "Calendar") &&
    model.calendar.selected.length === 1 &&
    model.calendar.selected[0] === key &&
    visibleDays(model.calendar.navigation).includes(day)
  ) {
    return { model };
  }

  return selectReminderNotification(model, current, apply);
};
