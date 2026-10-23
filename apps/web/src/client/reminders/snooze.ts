import { Option } from "effect";

import type { AppModel, AppMessage, update } from "../app.js";
import { Message } from "../message.js";
import { currentReminderCard } from "./card-selection.js";
import { stepReminder } from "./machine.js";
import {
  ReminderSnoozeRestore,
  ReminderSnoozeStorage,
  reminderSnoozeCanStart,
} from "./model.js";
import {
  PersistReminderSnooze,
  SampleReminderSnoozeClock,
} from "./snooze-commands.js";
import { RevealReminderSnooze } from "./snooze-surface.js";
import { commitReminders, resolveReminderPresentation } from "./update.js";

type Result = ReturnType<typeof update>;

type Apply = (model: AppModel, message: AppMessage) => Result;

export const reminderSnoozeDisclosureChanged = (
  model: AppModel,
  message: ReturnType<typeof Message.ReminderSnoozeDisclosureChanged>
): Result =>
  !message.open ||
  currentReminderCard(model, message.personId, message.id) === undefined
    ? { model }
    : {
        commands: [
          RevealReminderSnooze({ id: message.id, personId: message.personId }),
        ],
        model,
      };

const acceptReminderSnoozeAtObservedTime = (
  model: AppModel,
  message: ReturnType<typeof Message.RequestedReminderSnooze>
): Result => {
  const notification = currentReminderCard(model, message.personId, message.id);

  if (
    notification === undefined ||
    !reminderSnoozeCanStart(model.reminders.context.snoozeStorage)
  ) {
    return { model };
  }

  if (
    message.choice === "start" &&
    notification.candidate.start <= model.calendar.now
  ) {
    return {
      model: {
        ...model,
        reminders: {
          ...model.reminders,
          failure: Option.some(
            "The event has already started. Choose a duration instead."
          ),
        },
      },
    };
  }

  const entry = {
    due:
      message.choice === "start"
        ? notification.candidate.start
        : model.calendar.now + message.choice * 60_000,
    identity: notification.candidate.identity,
  };

  if (
    ReminderSnoozeStorage.guards.Failed(model.reminders.context.snoozeStorage)
  ) {
    const accepted = commitReminders(model, {
      ...stepReminder(model.reminders, {
        entry,
        id: message.id,
        type: "SNOOZE_SESSION_ACCEPTED",
      }),
      failure: Option.none(),
    });

    const resolved = resolveReminderPresentation(
      accepted.model,
      message.personId,
      message.id
    );

    return {
      ...resolved,
      commands: [...(accepted.commands ?? []), ...(resolved.commands ?? [])],
    };
  }

  const next = commitReminders(model, {
    ...stepReminder(model.reminders, {
      entry,
      id: message.id,
      type: "SNOOZE_REQUESTED",
    }),
    failure: Option.none(),
  });

  return {
    ...next,
    commands: [
      ...(next.commands ?? []),
      PersistReminderSnooze({
        entry,
        id: message.id,
        personId: message.personId,
      }),
    ],
  };
};

export const requestReminderSnooze = (
  model: AppModel,
  message: ReturnType<typeof Message.RequestedReminderSnooze>
): Result => {
  const notification = currentReminderCard(model, message.personId, message.id);

  if (
    notification === undefined ||
    model.action === "pending" ||
    !reminderSnoozeCanStart(model.reminders.context.snoozeStorage)
  ) {
    return { model };
  }

  const operation = {
    choice: message.choice,
    id: message.id,
    identity: notification.candidate.identity,
  };

  const next = commitReminders(model, {
    ...stepReminder(model.reminders, { ...operation, type: "SNOOZE_SAMPLING" }),
    failure: Option.none(),
  });

  return {
    ...next,
    commands: [
      ...(next.commands ?? []),
      SampleReminderSnoozeClock({ ...operation, personId: message.personId }),
    ],
  };
};

export const completeReminderSnoozeClock = (
  model: AppModel,
  message: ReturnType<typeof Message.ReminderSnoozeClockSampled>,
  apply: Apply
): Result => {
  const storage = model.reminders.context.snoozeStorage;

  if (
    !Option.contains(model.person, message.personId) ||
    !ReminderSnoozeStorage.guards.Sampling(storage) ||
    storage.id !== message.id ||
    storage.identity !== message.identity ||
    storage.choice !== message.choice
  ) {
    return { model };
  }

  if (model.action === "pending") {
    return commitReminders(
      model,
      stepReminder(model.reminders, {
        choice: message.choice,
        id: message.id,
        identity: message.identity,
        type: "SNOOZE_SAMPLED",
      })
    );
  }

  const observed = apply(model, Message.Ticked({ now: message.now }));

  const ready = commitReminders(
    observed.model,
    stepReminder(observed.model.reminders, {
      choice: message.choice,
      id: message.id,
      identity: message.identity,
      type: "SNOOZE_SAMPLED",
    })
  );

  const acceptedSnooze = acceptReminderSnoozeAtObservedTime(
    ready.model,
    Message.RequestedReminderSnooze({
      choice: message.choice,
      id: message.id,
      personId: message.personId,
    })
  );

  return {
    ...acceptedSnooze,
    commands: [
      ...(observed.commands ?? []),
      ...(ready.commands ?? []),
      ...(acceptedSnooze.commands ?? []),
    ],
  };
};

export const completeReminderSnoozeRestore = (
  model: AppModel,
  message: ReturnType<typeof Message.ReminderSnoozesRestored>,
  apply: Apply
): Result => {
  if (
    !Option.contains(model.person, message.personId) ||
    !(
      ReminderSnoozeStorage.guards.Loading(
        model.reminders.context.snoozeStorage
      ) ||
      ReminderSnoozeStorage.guards.Unloaded(
        model.reminders.context.snoozeStorage
      ) ||
      model.reminders.context.snoozeStorage === undefined
    )
  ) {
    return { model };
  }

  const loading = ReminderSnoozeStorage.guards.Loading(
    model.reminders.context.snoozeStorage
  )
    ? model.reminders
    : stepReminder(model.reminders, { type: "SNOOZE_LOADING" });

  const restored = commitReminders(model, {
    ...stepReminder(loading, {
      now: message.now ?? model.calendar.now,
      outcome: message.outcome,
      type: "SNOOZE_RESTORED",
    }),
    failure: ReminderSnoozeRestore.guards.Failed(message.outcome)
      ? Option.some(
          "Reminder snoozes could not be restored. Reload to try again."
        )
      : model.reminders.failure,
  });

  const observed: Result =
    message.now === undefined
      ? { model: restored.model }
      : apply(restored.model, Message.Ticked({ now: message.now }));

  return {
    ...observed,
    commands: [...(restored.commands ?? []), ...(observed.commands ?? [])],
  };
};

export const completeReminderSnoozeSave = (
  model: AppModel,
  message: ReturnType<typeof Message.ReminderSnoozeSaved>
): Result => {
  const storage = model.reminders.context.snoozeStorage;

  if (
    !Option.contains(model.person, message.personId) ||
    !ReminderSnoozeStorage.guards.Saving(storage) ||
    storage.id !== message.id ||
    storage.entry.identity !== message.entry.identity ||
    storage.entry.due !== message.entry.due
  ) {
    return { model };
  }

  const next = commitReminders(model, {
    ...stepReminder(model.reminders, {
      entry: message.entry,
      failed: message.failed,
      id: message.id,
      type: "SNOOZE_SAVED",
    }),
    failure: message.failed
      ? Option.some("This reminder could not be snoozed. Try again.")
      : Option.none(),
  });

  if (message.failed) {
    return next;
  }

  const resolved = resolveReminderPresentation(
    next.model,
    message.personId,
    message.id
  );

  return {
    ...resolved,
    commands: [...(next.commands ?? []), ...(resolved.commands ?? [])],
  };
};

export const completeReminderSnoozeCleanup = (
  model: AppModel,
  message: ReturnType<typeof Message.ReminderSnoozeCacheCleaned>
): Result =>
  !message.failed || !Option.contains(model.person, message.personId)
    ? { model }
    : {
        model: {
          ...model,
          reminders: {
            ...model.reminders,
            failure: Option.some(
              "The reminder snooze cache could not be updated."
            ),
          },
        },
      };
