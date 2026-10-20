import type { EventRemindersValue, ReminderValue } from "./model.js";

const reminderKeys = (reminders: readonly ReminderValue[]) =>
  new Set(
    reminders.map(({ method, minutes }) => JSON.stringify([method, minutes]))
  );

export const normalizeReminderSet = (
  overrides: readonly ReminderValue[],
  defaults: readonly ReminderValue[]
): EventRemindersValue => {
  const selected = reminderKeys(overrides);
  const inherited = reminderKeys(defaults);

  return selected.size === inherited.size &&
    [...selected].every((key) => inherited.has(key))
    ? { useDefault: true }
    : { overrides, useDefault: false };
};
