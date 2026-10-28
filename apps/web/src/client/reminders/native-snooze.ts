import type { NativeNotificationRef } from "@calendar/core/desktop-bridge";
import { sameDesktopEventKey } from "@calendar/core/desktop-bridge";
import { Option } from "effect";

import type { AppModel } from "../app.js";
import { acceptedReminderCandidates } from "./accepted-candidates.js";
import {
  eligibleNotificationEvent,
  eligibleSnoozedReminder,
} from "./candidates.js";
import { currentReminderCard } from "./card-selection.js";
import type { NotificationContentValue } from "./model.js";
import {
  nativeNotificationLease,
  nativeRemindersEnabled,
} from "./native-projection.js";
import { commitReminders, resolveReminderPresentation } from "./update.js";

type Reference = typeof NativeNotificationRef.Type;

const sameNativeOccurrence = (left: Reference, right: Reference): boolean =>
  left.id === right.id &&
  left.personId === right.personId &&
  left.lease === right.lease &&
  left.kind === right.kind &&
  left.start === right.start &&
  sameDesktopEventKey(left.key, right.key);

export const sameNativeSnoozeReceipt = (
  left: Reference | undefined,
  right: Reference | undefined
): boolean =>
  left === undefined || right === undefined
    ? left === right
    : sameNativeOccurrence(left, right) &&
      left.generation === right.generation &&
      left.revision === right.revision;

export const currentNativeSnooze = (
  model: AppModel,
  ref: Reference
): NotificationContentValue | undefined => {
  if (
    model.action === "pending" ||
    !Option.contains(model.person, ref.personId) ||
    !nativeRemindersEnabled(model) ||
    nativeNotificationLease(model) !== ref.lease ||
    ref.kind !== "reminder" ||
    ref.revision > (model.desktop.notificationRevision ?? 0)
  ) {
    return undefined;
  }

  const notification = model.reminders.context.active.find(
    (entry) => entry.id === ref.id && entry.personId === ref.personId
  );

  if (
    notification?.nativeKind !== "reminder" ||
    notification.nativeRef === undefined ||
    notification.nativeRef.generation !== ref.generation ||
    !sameNativeOccurrence(notification.nativeRef, ref) ||
    notification.candidate.start !== ref.start ||
    !sameDesktopEventKey(notification.candidate.event, ref.key)
  ) {
    return undefined;
  }

  const candidate = acceptedReminderCandidates(model).find(
    (item) =>
      item.start === ref.start &&
      sameDesktopEventKey(item.event, ref.key) &&
      (eligibleNotificationEvent(item, model.calendar.now) ||
        (notification.nativeSnoozedUntil !== undefined &&
          notification.nativeSnoozedUntil <= model.calendar.now &&
          eligibleSnoozedReminder(item)))
  );

  return candidate === undefined ? undefined : { ...notification, candidate };
};

export const currentSnoozeTarget = (
  model: AppModel,
  personId: string,
  id: string,
  ref?: Reference
): NotificationContentValue | undefined => {
  if (ref === undefined) {
    return currentReminderCard(model, personId, id);
  }

  return ref.id === id && ref.personId === personId
    ? currentNativeSnooze(model, ref)
    : undefined;
};

export const resolveSnoozedPresentation = (
  model: AppModel,
  personId: string,
  id: string,
  ref?: Reference
) => {
  if (ref === undefined) {
    return resolveReminderPresentation(model, personId, id);
  }

  if (currentSnoozeTarget(model, personId, id, ref) === undefined) {
    return { model };
  }

  return commitReminders(model, {
    ...model.reminders,
    context: {
      ...model.reminders.context,
      active: model.reminders.context.active.filter((entry) => entry.id !== id),
      close: [id],
      deliveries: [],
    },
  });
};
