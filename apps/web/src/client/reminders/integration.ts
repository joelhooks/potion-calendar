import { Option, Schema } from "effect";

import type { AppModel, update } from "../app.js";
import { desktopDependencies } from "../desktop/subscription.js";
import { DeliverReminderNotification } from "./commands.js";
import { initialReminderState, stepReminder } from "./machine.js";
import { NotificationContent, ReminderSnoozeStorage } from "./model.js";
import {
  nativeNotificationLease,
  nativeNotificationAgenda,
  nativeRemindersEnabled,
} from "./native-projection.js";
import { releaseResolvedReminderEvents } from "./retained.js";
import { reminderSnapshot } from "./source.js";
import { commitReminders } from "./update.js";

type Result = ReturnType<typeof update>;

const inputsChanged = (previous: AppModel, next: AppModel): boolean =>
  previous.calendar.now !== next.calendar.now ||
  previous.calendar.calendars !== next.calendar.calendars ||
  previous.calendar.hidden !== next.calendar.hidden ||
  previous.calendar.zone !== next.calendar.zone ||
  previous.upcoming.data !== next.upcoming.data ||
  previous.upcoming.accepted !== next.upcoming.accepted ||
  previous.session !== next.session ||
  previous.settings !== next.settings ||
  previous.desktop.availability !== next.desktop.availability ||
  (nativeNotificationLease(next) !== undefined &&
    previous.desktop.settings !== next.desktop.settings) ||
  previous.reminders.context.permission !== next.reminders.context.permission ||
  previous.reminders.context.snoozes !== next.reminders.context.snoozes ||
  previous.reminders.context.snoozeStorage !==
    next.reminders.context.snoozeStorage;

const startReminders = (previous: AppModel, model: AppModel): Result => {
  const samePerson =
    Option.isSome(model.person) &&
    Option.contains(previous.person, model.person.value);

  const memory = samePerson
    ? previous.reminders.context
    : model.reminders.context;

  const cache =
    model.reminders.context.snoozeStorage === undefined ||
    ReminderSnoozeStorage.guards.Unloaded(model.reminders.context.snoozeStorage)
      ? memory
      : model.reminders.context;

  return commitReminders(
    model,
    stepReminder(
      {
        ...model.reminders,
        context: {
          ...model.reminders.context,
          active: memory.active,
          fired: memory.fired,
          lastChecked: memory.lastChecked,
          permission: memory.permission,
          snoozeStorage:
            cache.snoozeStorage ?? model.reminders.context.snoozeStorage,
          snoozes: cache.snoozes ?? [],
        },
      },
      { now: model.calendar.now, type: "START" }
    )
  );
};

const updateReminders = (previous: AppModel, result: Result): Result => {
  if (result.model === previous) {
    return result;
  }

  const personChanged =
    Option.getOrUndefined(previous.person) !==
    Option.getOrUndefined(result.model.person);

  const commands = [...(result.commands ?? [])];
  let { model } = result;

  if (personChanged) {
    const stopped = commitReminders(
      previous,
      stepReminder(previous.reminders, { type: "STOP" })
    );

    commands.push(...(stopped.commands ?? []));
    model = { ...model, reminders: initialReminderState() };
  }

  if (Option.isNone(model.person)) {
    model = releaseResolvedReminderEvents(model);

    return commands.length === 0
      ? { ...result, model }
      : { ...result, commands, model };
  }

  const starting = model.reminders.value === "stopped";

  if (starting) {
    const started = startReminders(previous, model);
    ({ model } = started);
    commands.push(...(started.commands ?? []));
  }

  if (
    model.reminders.context.snoozeStorage === undefined ||
    ReminderSnoozeStorage.guards.Unloaded(model.reminders.context.snoozeStorage)
  ) {
    const restoring = commitReminders(
      model,
      stepReminder(model.reminders, { type: "SNOOZE_LOADING" })
    );

    ({ model } = restoring);
    commands.push(...(restoring.commands ?? []));
  }

  if (starting || inputsChanged(previous, model)) {
    const snapshot = reminderSnapshot(model);

    if (snapshot !== undefined) {
      const scanned = commitReminders(
        model,
        stepReminder(
          model.reminders,
          nativeNotificationLease(model) === undefined
            ? {
                ...snapshot,
                snoozeRangeReady: snapshot.snoozeRangeReady,
                type: "SCAN",
                webCards: model.desktop.availability === "unavailable",
              }
            : {
                ...snapshot,
                native: true,
                nativeEnabled: nativeRemindersEnabled(model),
                snoozeRangeReady: snapshot.snoozeRangeReady,
                type: "NATIVE_SCAN",
                webCards: false,
              }
        )
      );

      ({ model } = scanned);
      commands.push(...(scanned.commands ?? []));
    }
  }

  model = releaseResolvedReminderEvents(model);

  return commands.length === 0
    ? { ...result, model }
    : { ...result, commands, model };
};

const nativePublication = (model: AppModel): string => {
  const agenda = nativeNotificationAgenda(model);

  return JSON.stringify(
    agenda === undefined
      ? null
      : {
          deliveries: agenda.deliveries,
          events: agenda.events,
          lease: agenda.lease,
          personId: agenda.personId,
        }
  );
};

const stampNativePublication = (
  previous: AppModel,
  model: AppModel
): AppModel => {
  if (
    nativeNotificationLease(model) === undefined &&
    previous.desktop.notificationRevision === undefined
  ) {
    return model;
  }

  const revision =
    (previous.desktop.notificationRevision ?? 0) +
    (nativePublication(previous) === nativePublication(model) ? 0 : 1);

  return model.desktop.notificationRevision === revision
    ? model
    : {
        ...model,
        desktop: { ...model.desktop, notificationRevision: revision },
      };
};

type ReminderCommand = NonNullable<Result["commands"]>[number];

const bindNativePublication = (
  model: AppModel,
  command: ReminderCommand
): ReminderCommand => {
  if (command.name !== "DeliverReminderNotification") {
    return command;
  }

  const args = Schema.decodeUnknownSync(
    Schema.Struct({ notification: NotificationContent })
  )(command.args);

  return args.notification.native === undefined
    ? command
    : DeliverReminderNotification({
        notification: {
          ...args.notification,
          native: { snapshot: desktopDependencies(model).snapshot },
        },
      });
};

export const withReminders = (previous: AppModel, result: Result): Result => {
  if (result.model === previous) {
    return result;
  }

  const updated = updateReminders(previous, {
    ...result,
    model: stampNativePublication(previous, result.model),
  });

  const model = stampNativePublication(previous, updated.model);

  return updated.commands === undefined
    ? { ...updated, model }
    : {
        ...updated,
        commands: updated.commands.map((command) =>
          bindNativePublication(model, command)
        ),
        model,
      };
};
