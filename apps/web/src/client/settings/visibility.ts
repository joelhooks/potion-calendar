import type {
  CalendarRefValue,
  CalendarValue,
  ListCalendarsOutput,
} from "@calendar/calendar/contracts";

import { calendarKey } from "../calendar-state.js";
import { VisibilityMigration } from "./visibility-model.js";
import type {
  VisibilityChoicesValue,
  VisibilityMigrationValue,
} from "./visibility-model.js";

export const calendarVisible = (
  calendar: CalendarValue,
  choices: VisibilityChoicesValue,
  migration: VisibilityMigrationValue
): boolean => {
  const local = choices[calendarKey(calendar.accountId, calendar.calendarId)];

  if (local !== undefined) {
    return local;
  }

  if (
    VisibilityMigration.guards.Legacy(migration) ||
    (VisibilityMigration.guards.Accounts(migration) &&
      migration.ids.includes(calendar.accountId))
  ) {
    return true;
  }

  return calendar.selected === true;
};

export const hiddenCalendars = (
  calendars: readonly CalendarValue[],
  choices: VisibilityChoicesValue,
  migration: VisibilityMigrationValue
): readonly string[] =>
  [
    ...new Set([
      ...Object.entries(choices).flatMap(([key, shown]) =>
        shown ? [] : [key]
      ),
      ...calendars.flatMap((calendar) =>
        calendarVisible(calendar, choices, migration)
          ? []
          : [calendarKey(calendar.accountId, calendar.calendarId)]
      ),
    ]),
  ].toSorted();

export const chooseVisibility = (
  calendars: readonly CalendarValue[],
  choices: VisibilityChoicesValue,
  migration: VisibilityMigrationValue,
  ref: CalendarRefValue,
  shown: boolean
) => {
  const visibility = {
    ...choices,
    [calendarKey(ref.accountId, ref.calendarId)]: shown,
  };

  return {
    hidden: hiddenCalendars(calendars, visibility, migration),
    visibility,
  };
};

export const migrateVisibility = (
  inventory: typeof ListCalendarsOutput.Type,
  choices: VisibilityChoicesValue,
  migration: VisibilityMigrationValue,
  accountIds: readonly string[]
) => {
  if (VisibilityMigration.guards.Current(migration)) {
    return { migration, visibility: choices };
  }

  const pending = new Set(
    VisibilityMigration.guards.Accounts(migration)
      ? migration.ids.filter((id) => accountIds.includes(id))
      : accountIds
  );

  const visibility = { ...choices };

  for (const account of inventory.accounts) {
    if (!pending.has(account.accountId) || !("calendars" in account)) {
      continue;
    }

    for (const calendar of account.calendars) {
      const key = calendarKey(calendar.accountId, calendar.calendarId);

      if (visibility[key] === undefined && calendar.selected !== true) {
        visibility[key] = true;
      }
    }

    pending.delete(account.accountId);
  }

  return {
    migration:
      pending.size === 0
        ? VisibilityMigration.cases.Current.make({})
        : VisibilityMigration.cases.Accounts.make({
            ids: [...pending].toSorted(),
          }),
    visibility,
  };
};
