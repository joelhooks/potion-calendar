import { Option } from "effect";

import type { AppModel, update } from "../app.js";
import { initialReminderState, stepReminder } from "./machine.js";
import { ReminderSnoozeStorage } from "./model.js";
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

export const withReminders = (previous: AppModel, result: Result): Result => {
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
        stepReminder(model.reminders, {
          ...snapshot,
          snoozeRangeReady: snapshot.snoozeRangeReady,
          type: "SCAN",
          webCards: model.desktop.availability === "unavailable",
        })
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
