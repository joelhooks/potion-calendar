import { DateTime, pipe } from "effect";
import { AsyncData } from "foldkit";

import type { AppModel } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import type { PhoneShellValue } from "../src/client/phone-shell/model.js";
import { dayInZone } from "../src/layout/navigation.js";
import { fixtureEvents, fixtureSelection } from "./fixture.js";

export const phoneShellFixture = (
  width: number,
  height: number,
  mode: PhoneShellValue["mode"] = "closed",
  theme: AppModel["settings"]["theme"] = "light"
): AppModel => {
  const model = fixtureSelection();

  const now = DateTime.toEpochMillis(
    DateTime.makeUnsafe("2026-10-19T08:50:00-07:00")
  );

  return {
    ...model,
    calendar: {
      ...model.calendar,
      navigation: {
        ...model.calendar.navigation,
        anchor: dayInZone(now, model.calendar.zone),
        mode: "day",
      },
      now,
      selected: mode === "details" ? model.calendar.selected : [],
      viewport: height - 145,
      viewportWidth: width,
    },
    phoneShell: { mode, viewportWidth: width },
    session: pipe(
      model.session,
      AsyncData.map((snapshot) =>
        snapshot === null
          ? null
          : {
              ...snapshot,
              accounts: snapshot.accounts.filter(
                (account) => !account.disconnected
              ),
            }
      )
    ),
    settings: { ...model.settings, theme },
    upcoming: {
      ...model.upcoming,
      data: RemoteEvents.Success({
        data: { events: fixtureEvents.slice(0, 1), versions: [] },
      }),
    },
  };
};

export const phoneShellScenes = [
  { height: 844, mode: "closed", theme: "light", width: 390 },
  { height: 932, mode: "closed", theme: "dark", width: 430 },
  { height: 844, mode: "drawer", theme: "dark", width: 390 },
  { height: 932, mode: "drawer", theme: "light", width: 430 },
  { height: 844, mode: "details", theme: "light", width: 390 },
  { height: 932, mode: "details", theme: "dark", width: 430 },
  { height: 844, mode: "upcoming", theme: "dark", width: 390 },
  { height: 932, mode: "upcoming", theme: "light", width: 430 },
] satisfies readonly {
  readonly height: number;
  readonly mode: PhoneShellValue["mode"];
  readonly theme: AppModel["settings"]["theme"];
  readonly width: number;
}[];
