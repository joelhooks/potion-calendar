import { Option } from "effect";

import type { AppModel, update } from "../app.js";
import type { Message } from "../message.js";
import { reminderOccurrence, resolveReminderCard } from "./action-machine.js";
import {
  CloseReminderNotifications,
  DeliverReminderNotification,
  RequestReminderPermission,
} from "./commands.js";
import { stepReminder } from "./machine.js";
import {
  NotificationEvent,
  PermissionOutcome,
  reminderSnoozeIsSessionOnly,
} from "./model.js";
import type { ReminderState } from "./model.js";
import { RemoveReminderSnoozes } from "./snooze-commands.js";

type Result = ReturnType<typeof update>;

export const commitReminders = (
  model: AppModel,
  state: typeof ReminderState.Type
): Result => {
  const removed =
    state.value === "stopped"
      ? []
      : (model.reminders.context.snoozes ?? []).filter(
          (entry) =>
            !(state.context.snoozes ?? []).some(
              (next) =>
                next.identity === entry.identity && next.due === entry.due
            )
        );

  return {
    commands: Option.isSome(model.person)
      ? [
          ...(removed.length === 0 ||
          reminderSnoozeIsSessionOnly(state.context.snoozeStorage)
            ? []
            : [
                RemoveReminderSnoozes({
                  entries: removed,
                  personId: model.person.value,
                }),
              ]),
          ...(state.context.close.length === 0
            ? []
            : [
                CloseReminderNotifications({
                  ids: state.context.close,
                  personId: model.person.value,
                }),
              ]),
          ...state.context.deliveries
            .filter(
              (notification) =>
                notification.card === undefined ||
                state.context.permission === "granted"
            )
            .map((notification) =>
              DeliverReminderNotification({ notification })
            ),
        ]
      : [],
    model: {
      ...model,
      reminders: {
        ...state,
        context: { ...state.context, close: [], deliveries: [] },
      },
    },
  };
};

export const resolveReminderPresentation = (
  model: AppModel,
  personId: string,
  id: string,
  event: "RESOLVE" | "EXPIRE" = "RESOLVE"
): Result => {
  if (!Option.contains(model.person, personId)) {
    return { model };
  }

  const notification = model.reminders.context.active.find(
    (item) => item.id === id && item.personId === personId
  );

  if (
    notification?.card === undefined ||
    resolveReminderCard(notification.card, event).state !== "resolved"
  ) {
    return { model };
  }

  const dismissed = model.reminders.context.dismissedPrompts ?? [];
  const occurrence = reminderOccurrence(personId, notification.candidate);

  return commitReminders(model, {
    ...model.reminders,
    context: {
      ...model.reminders.context,
      active: model.reminders.context.active.filter((item) => item.id !== id),
      close: [id],
      deliveries: [],
      dismissedPrompts:
        event === "RESOLVE" &&
        notification.card.kind === "upcoming" &&
        !dismissed.includes(occurrence)
          ? [...dismissed, occurrence]
          : dismissed,
    },
  });
};

export const requestReminders = (model: AppModel): Result => {
  if (Option.isNone(model.person)) {
    return { model };
  }

  const state =
    model.reminders.value === "stopped"
      ? stepReminder(model.reminders, {
          now: model.calendar.now,
          type: "START",
        })
      : model.reminders;

  if (state.value !== "permissionUnknown") {
    return { model };
  }

  const requested = commitReminders(model, {
    ...stepReminder(state, { type: "REQUEST" }),
    failure: Option.none(),
  });

  return {
    ...requested,
    commands: [
      ...(requested.commands ?? []),
      RequestReminderPermission({ personId: model.person.value }),
    ],
  };
};

export const completeReminderPermission = (
  model: AppModel,
  result: ReturnType<typeof Message.ReminderPermissionCompleted>
): Result => {
  if (!Option.contains(model.person, result.personId)) {
    return { model };
  }

  if (PermissionOutcome.guards.Failed(result.outcome)) {
    const next = stepReminder(model.reminders, {
      now: result.now,
      permission: model.reminders.context.permission,
      type: "PERMISSION",
    });

    return commitReminders(model, {
      ...next,
      failure: Option.some(
        "Browser notification permission could not be requested."
      ),
    });
  }

  return commitReminders(model, {
    ...stepReminder(model.reminders, {
      now: result.now,
      permission: result.outcome.permission,
      type: "PERMISSION",
    }),
    failure: Option.none(),
  });
};

const failNotification = (
  model: AppModel,
  personId: string,
  id: string,
  report: boolean
): Result => {
  if (
    !Option.contains(model.person, personId) ||
    !model.reminders.context.active.some(
      (notification) => notification.id === id
    )
  ) {
    return { model };
  }

  return {
    model: {
      ...model,
      reminders: {
        ...model.reminders,
        context: {
          ...model.reminders.context,
          active: model.reminders.context.active.filter(
            (notification) =>
              notification.id !== id || notification.card !== undefined
          ),
        },
        failure: report
          ? Option.some(
              "A notification could not be shown. Check this site's notification permission."
            )
          : model.reminders.failure,
      },
    },
  };
};

export const completeReminderDelivery = (
  model: AppModel,
  result: ReturnType<typeof Message.ReminderDeliveryCompleted>
): Result => {
  if (Option.isNone(result.failure)) {
    return { model };
  }

  const { reason } = result.failure.value;

  const notification = model.reminders.context.active.find(
    (item) => item.id === result.id && item.personId === result.personId
  );

  if (reason === "expired" && notification?.card !== undefined) {
    return resolveReminderPresentation(
      model,
      result.personId,
      result.id,
      "EXPIRE"
    );
  }

  return failNotification(
    model,
    result.personId,
    result.id,
    reason !== "expired" && reason !== "inactive"
  );
};

export const observeReminder = (
  model: AppModel,
  event: typeof NotificationEvent.Type,
  now: number
): Result => {
  if (NotificationEvent.guards.Permission(event)) {
    if (
      !Option.contains(model.person, event.personId) ||
      (model.reminders.value === "requesting" && event.permission === "default")
    ) {
      return { model };
    }

    return commitReminders(model, {
      ...stepReminder(model.reminders, {
        now,
        permission: event.permission,
        type: "PERMISSION",
      }),
      failure: Option.none(),
    });
  }

  if (NotificationEvent.guards.Closed(event)) {
    return { model };
  }

  return NotificationEvent.guards.Failed(event)
    ? failNotification(model, event.personId, event.id, true)
    : { model };
};
