import type {
  CalendarRefValue,
  CalendarValue,
  ListCalendarsOutput,
} from "@calendar/calendar/contracts";

import { calendarKey } from "../calendar-state.js";
import type { SettingsManagementValue } from "./model.js";

type Inventory = typeof ListCalendarsOutput.Type;

export const calendarPalette = (
  inventory: Inventory | undefined,
  accountId: string
) => {
  const account = inventory?.accounts.find(
    (entry) => entry.accountId === accountId
  );

  return account !== undefined && "colors" in account
    ? account.colors.calendar
    : {};
};

export const projectCalendars = (
  inventory: Inventory,
  state: SettingsManagementValue
): readonly CalendarValue[] =>
  inventory.accounts.flatMap((account) => {
    if (
      !("calendars" in account) ||
      state.removedAccounts.includes(account.accountId)
    ) {
      return [];
    }

    return account.calendars.map((calendar) => {
      const pending = state.colours.find(
        (task) =>
          calendarKey(task.accountId, task.calendarId) ===
          calendarKey(calendar.accountId, calendar.calendarId)
      );

      const colour =
        pending === undefined
          ? undefined
          : account.colors.calendar[pending.colorId];

      return colour === undefined || pending === undefined
        ? calendar
        : {
            ...calendar,
            backgroundColor: colour.background,
            colorId: pending.colorId,
            foregroundColor: colour.foreground,
          };
    });
  });

const committedColour = (
  calendar: CalendarValue,
  updated: CalendarValue
): CalendarValue => {
  let next = calendar;

  if (updated.colorId !== undefined) {
    next = { ...next, colorId: updated.colorId };
  }

  if (updated.backgroundColor !== undefined) {
    next = { ...next, backgroundColor: updated.backgroundColor };
  }

  if (updated.foregroundColor !== undefined) {
    next = { ...next, foregroundColor: updated.foregroundColor };
  }

  return next;
};

export const replaceCalendar = (
  inventory: Inventory,
  updated: CalendarValue
): Inventory => ({
  accounts: inventory.accounts.map((account) =>
    "calendars" in account && account.accountId === updated.accountId
      ? {
          ...account,
          calendars: account.calendars.map((calendar) =>
            calendar.calendarId === updated.calendarId
              ? committedColour(calendar, updated)
              : calendar
          ),
        }
      : account
  ),
});

export const removeAccounts = (
  inventory: Inventory,
  removed: readonly string[]
): Inventory => ({
  accounts: inventory.accounts.filter(
    (account) => !removed.includes(account.accountId)
  ),
});

export const colourPending = (
  state: SettingsManagementValue,
  ref: CalendarRefValue
): boolean =>
  state.colours.some(
    (task) =>
      calendarKey(task.accountId, task.calendarId) ===
      calendarKey(ref.accountId, ref.calendarId)
  );
