import { Option } from "effect";
import { AsyncData } from "foldkit";

import { participantEmail } from "../../layout/email-participants.js";
import type { ParticipantEmail } from "../../layout/email-participants.js";
import type { AppModel } from "../app.js";
import { reminderCardExpired } from "./action-machine.js";
import {
  eligibleNotificationEvent,
  eligibleSnoozedReminder,
} from "./candidates.js";
import type { NotificationContentValue } from "./model.js";
import { reminderSnapshot } from "./source.js";

export const currentReminderCard = (
  model: AppModel,
  personId: string,
  id: string
): NotificationContentValue | undefined => {
  if (
    model.desktop.availability !== "unavailable" ||
    !Option.contains(model.person, personId)
  ) {
    return undefined;
  }

  const active = model.reminders.context.active.find(
    (item) =>
      item.id === id &&
      item.personId === personId &&
      item.card?.state === "active"
  );

  const candidate = reminderSnapshot(model)?.candidates.find(
    (item) =>
      active !== undefined &&
      item.identity === active.candidate.identity &&
      item.start === active.candidate.start
  );

  return active !== undefined &&
    candidate !== undefined &&
    (active.card?.snoozedUntil === undefined
      ? eligibleNotificationEvent(candidate, model.calendar.now)
      : eligibleSnoozedReminder(candidate)) &&
    !reminderCardExpired(active, model.calendar.now)
    ? { ...active, candidate }
    : undefined;
};

export const reminderParticipantEmail = (
  model: AppModel,
  notification: NotificationContentValue
): ParticipantEmail => {
  const current = currentReminderCard(
    model,
    notification.personId,
    notification.id
  );

  const session = Option.getOrUndefined(AsyncData.getData(model.session));

  return current === undefined ||
    session === undefined ||
    session === null ||
    !Option.contains(model.person, session.user.id)
    ? { kind: "disabled" }
    : participantEmail(current.candidate.event, [
        session.user.email,
        ...session.accounts.map((account) => account.email),
      ]);
};
