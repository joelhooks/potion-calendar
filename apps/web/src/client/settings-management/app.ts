import type { ListCalendarsOutput } from "@calendar/calendar/contracts";
import { Option, pipe } from "effect";
import { AsyncData } from "foldkit";

import type { AppModel } from "../app.js";
import { RemoteCalendars } from "../calendar-state.js";
import { refreshSearch } from "../search/update.js";
import { VisibilityMigration } from "../settings/visibility-model.js";
import { hiddenCalendars, migrateVisibility } from "../settings/visibility.js";
import type { ManagementChange, SettingsManagementValue } from "./model.js";
import {
  projectCalendars,
  removeAccounts,
  replaceCalendar,
} from "./projection.js";
import { changeManagement } from "./update.js";

type ManagedModel = AppModel & {
  readonly settingsManagement: SettingsManagementValue;
};

export const projectManagement = (model: ManagedModel): ManagedModel => {
  const inventory = Option.getOrUndefined(
    AsyncData.getData(model.calendar.index)
  );

  if (inventory === undefined) {
    return model;
  }

  const calendars = projectCalendars(inventory, model.settingsManagement);

  return {
    ...model,
    calendar: {
      ...model.calendar,
      calendars,
      hidden: hiddenCalendars(
        calendars,
        model.calendar.visibility,
        model.calendar.visibilityMigration
      ),
    },
  };
};

export const receiveManagedInventory = (
  model: ManagedModel,
  result: typeof ListCalendarsOutput.Type
) => {
  const session = Option.getOrUndefined(AsyncData.getData(model.session));

  const missing = (session?.accounts ?? []).flatMap((account) =>
    result.accounts.some((entry) => entry.accountId === account.id)
      ? []
      : [account.id]
  );

  const removed = [
    ...new Set([...model.settingsManagement.removedAccounts, ...missing]),
  ];

  const inventory = removeAccounts(result, removed);

  const visibility = migrateVisibility(
    inventory,
    model.calendar.visibility,
    model.calendar.visibilityMigration,
    inventory.accounts.map((account) => account.accountId)
  );

  const next = projectManagement({
    ...model,
    calendar: {
      ...model.calendar,
      index: RemoteCalendars.Success({ data: inventory }),
      reads: model.calendar.reads.filter(
        (read) => !removed.includes(read.accountId)
      ),
      visibility: visibility.visibility,
      visibilityMigration: visibility.migration,
    },
    session: pipe(
      model.session,
      AsyncData.map((snapshot) =>
        snapshot === null
          ? null
          : {
              ...snapshot,
              accounts: snapshot.accounts.filter(
                (account) => !removed.includes(account.id)
              ),
            }
      )
    ),
    settingsManagement: {
      ...model.settingsManagement,
      colours: model.settingsManagement.colours.filter(
        (task) => !removed.includes(task.accountId)
      ),
      removedAccounts: removed,
    },
  });

  return {
    migrationCompleted: !VisibilityMigration.guards.Current(
      model.calendar.visibilityMigration
    ),
    model: next,
  };
};

export const manageSettings = (
  model: ManagedModel,
  change: typeof ManagementChange.Type
) => {
  const session = Option.getOrUndefined(AsyncData.getData(model.session));

  const result = changeManagement(
    {
      accounts: session?.accounts ?? [],
      inventory: Option.getOrUndefined(AsyncData.getData(model.calendar.index)),
      person: model.person,
      state: model.settingsManagement,
    },
    change
  );

  let next: ManagedModel = { ...model, settingsManagement: result.state };

  if (result.calendar !== undefined) {
    const { calendar } = result;
    next = {
      ...next,
      calendar: {
        ...next.calendar,
        index: pipe(
          next.calendar.index,
          AsyncData.map((inventory) => replaceCalendar(inventory, calendar))
        ),
      },
    };
  }

  if (result.removed !== undefined) {
    const removed = result.removed.accountId;
    next = {
      ...next,
      calendar: {
        ...next.calendar,
        calendars: next.calendar.calendars.filter(
          (calendar) => calendar.accountId !== removed
        ),
        index: pipe(
          next.calendar.index,
          AsyncData.map((inventory) => removeAccounts(inventory, [removed]))
        ),
        reads: next.calendar.reads.filter((read) => read.accountId !== removed),
        selected: Option.none(),
      },
      session: pipe(
        next.session,
        AsyncData.map((snapshot) =>
          snapshot === null
            ? null
            : {
                ...snapshot,
                accounts: snapshot.accounts.filter(
                  (account) => account.id !== removed
                ),
              }
        )
      ),
    };
    next = { ...next, search: refreshSearch(next).search };
  }

  return {
    model: projectManagement(next),
    refresh: result.refresh === true,
    removed: result.removed !== undefined,
    task: result.task,
  };
};
