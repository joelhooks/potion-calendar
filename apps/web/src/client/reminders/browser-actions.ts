import { conferenceLink } from "../../layout/conferencing.js";
import type { AppModel } from "../app.js";
import {
  currentReminderCard,
  reminderParticipantEmail,
} from "./card-selection.js";
import { reminderSnoozeCanStart } from "./model.js";
import type {
  NotificationContentValue,
  ReminderNotificationAction,
} from "./model.js";

export const browserReminderActions = (
  model: AppModel,
  notification: NotificationContentValue
): readonly (typeof ReminderNotificationAction.Type)[] | undefined => {
  const current = currentReminderCard(
    model,
    notification.personId,
    notification.id
  );

  if (current === undefined) {
    return undefined;
  }

  const { event } = current.candidate;

  return [
    ...(conferenceLink(
      event.conferenceUrl,
      event.description,
      event.location
    ) === undefined
      ? []
      : ["join" as const]),
    ...(reminderParticipantEmail(model, current).kind === "ready"
      ? ["email" as const]
      : []),
    ...(reminderSnoozeCanStart(model.reminders.context.snoozeStorage)
      ? ["start" as const]
      : []),
  ];
};

export const notificationActions = (
  notification: NotificationContentValue,
  now: number,
  maxActions: number
): readonly { readonly action: string; readonly title: string }[] => {
  const available = notification.browserActions ?? [];
  const slots = Math.max(0, Math.min(Math.floor(maxActions), 2));

  return [
    ...(available.includes("join") ? [{ action: "join", title: "Join" }] : []),
    ...(available.includes("email")
      ? [{ action: "email", title: "Email participants" }]
      : []),
    ...(available.includes("start") && notification.candidate.start > now
      ? [{ action: "start", title: "Snooze until start" }]
      : []),
  ].slice(0, slots);
};
