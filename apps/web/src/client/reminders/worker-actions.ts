import { Option } from "effect";

import type { AppModel, update } from "../app.js";
import { Message } from "../message.js";
import type { AppMessage } from "../message.js";
import { actOnReminderCard } from "./actions.js";
import { selectBrowserReminder } from "./browser-click.js";
import { notificationTag } from "./model.js";
import type { NotificationEvent } from "./model.js";
import { selectReminderNotification } from "./selection.js";

type Result = ReturnType<typeof update>;

export const actOnWorkerNotification = (
  model: AppModel,
  event: typeof NotificationEvent.cases.Action.Type,
  apply: (model: AppModel, message: AppMessage) => Result
): Result => {
  const active = model.reminders.context.active.find(
    (item) => item.id === event.id && item.personId === event.personId
  );

  if (
    active === undefined ||
    notificationTag(active.personId, active.candidate.identity) !== event.tag ||
    !Option.contains(model.person, event.personId) ||
    model.desktop.availability !== "unavailable"
  ) {
    return { model };
  }

  if (event.action === "start") {
    return apply(
      model,
      Message.RequestedReminderSnooze({
        choice: "start",
        id: event.id,
        personId: event.personId,
      })
    );
  }

  if (active.card === undefined) {
    return event.action === "show"
      ? selectReminderNotification(model, active, apply)
      : { model };
  }

  if (event.action === "show") {
    return selectBrowserReminder(model, active, apply);
  }

  return actOnReminderCard(
    model,
    event.personId,
    event.id,
    event.action,
    apply
  );
};
