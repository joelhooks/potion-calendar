import { Option } from "effect";
import { AsyncData } from "foldkit";

import { Message, RemoteSession, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { RemoteCalendars } from "../src/client/calendar-state.js";
import {
  ManagementChange,
  ManagementOutcome,
  RemovalState,
} from "../src/client/settings-management/model.js";
import { AccountSettingsRoute, SettingsRoute } from "../src/layout/route.js";
import { fixtureModel } from "./fixture.js";
import { timeZonesFixture } from "./time-zones-fixture.js";

export type ManagementFixture =
  | "account"
  | "confirm"
  | "last"
  | "colours"
  | "primary";

const palette = {
  "1": { background: "#4986e8", foreground: "#ffffff" },
  "2": { background: "#225522", foreground: "#ffffff" },
  "3": { background: "#b8b8b8", foreground: "#202520" },
  "4": { background: "#7a367a", foreground: "#ffffff" },
  "5": { background: "#854326", foreground: "#ffffff" },
  "6": { background: "#285b67", foreground: "#ffffff" },
  "7": { background: "#dbcf9e", foreground: "#202520" },
  "8": { background: "#303f62", foreground: "#ffffff" },
};

export const settingsManagementFixture = (
  kind: ManagementFixture,
  dark: boolean,
  width: number
): AppModel => {
  if (kind === "primary") {
    const base = timeZonesFixture(
      false,
      dark,
      width - (width <= 1000 ? 185 + 260 : 220 + 300)
    );

    return {
      ...base,
      timeZones: {
        ...base.timeZones,
        preferences: { ...base.timeZones.preferences, secondary: [] },
      },
    };
  }

  const original = fixtureModel();
  const data = Option.getOrThrow(AsyncData.getData(original.calendar.index));

  const inventory = {
    accounts: data.accounts.map((account) =>
      "calendars" in account
        ? {
            ...account,
            calendars: account.calendars.map((calendar) => ({
              ...calendar,
              colorId: "1",
              hidden: calendar.calendarId === "hidden",
              selected: true,
            })),
            colors: { ...account.colors, calendar: palette },
          }
        : account
    ),
  };

  let model: AppModel = {
    ...original,
    calendar: {
      ...original.calendar,
      calendars: inventory.accounts.flatMap((account) =>
        "calendars" in account ? account.calendars : []
      ),
      index: RemoteCalendars.Success({ data: inventory }),
    },
    route:
      kind === "colours"
        ? SettingsRoute.make({ page: "calendars" })
        : AccountSettingsRoute.make({ accountId: "work" }),
    settings: { ...original.settings, theme: dark ? "dark" : "light" },
  };

  if (kind === "confirm" || kind === "last") {
    ({ model } = update(
      model,
      Message.ChangedSettingsManagement({
        change: ManagementChange.cases.Remove.make({ accountId: "work" }),
      })
    ));
  }

  if (kind === "colours") {
    ({ model } = update(
      model,
      Message.ChangedSettingsManagement({
        change: ManagementChange.cases.OpenPicker.make({
          accountId: "work",
          calendarId: "primary",
        }),
      })
    ));
  }

  if (kind === "last") {
    ({ model } = update(
      model,
      Message.ChangedSettingsManagement({
        change: ManagementChange.cases.ConfirmRemoval.make({
          accountId: "work",
        }),
      })
    ));

    if (!RemovalState.guards.Working(model.settingsManagement.removal)) {
      throw new Error("Expected pending removal fixture");
    }

    ({ model } = update(
      model,
      Message.ChangedSettingsManagement({
        change: ManagementChange.cases.Settled.make({
          outcome: ManagementOutcome.cases.Failed.make({
            problem: {
              kind: "lastAccount",
              message:
                "Keep at least one connected Google account. Add another account before removing this one.",
            },
            task: model.settingsManagement.removal.task,
          }),
        }),
      })
    ));

    const session = Option.getOrThrow(
      AsyncData.getData(model.session).pipe(
        Option.flatMap(Option.fromNullishOr)
      )
    );

    model = {
      ...model,
      calendar: {
        ...model.calendar,
        calendars: model.calendar.calendars.filter(
          (calendar) => calendar.accountId === "work"
        ),
        index: RemoteCalendars.Success({
          data: {
            accounts: inventory.accounts.filter(
              (account) => account.accountId === "work"
            ),
          },
        }),
      },
      session: RemoteSession.Success({
        data: {
          ...session,
          accounts: session.accounts.filter((account) => account.id === "work"),
        },
      }),
    };
  }

  return model;
};
