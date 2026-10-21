import type { AppModel } from "../src/client/app.js";
import { Message, update } from "../src/client/app.js";
import { SettingsChange } from "../src/client/settings/model.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { SettingsRoute } from "../src/layout/route.js";
import { fixtureModel } from "./fixture.js";

export const navigationScenarios = [
  "week-hidden",
  "week-hidden-weekends",
  "restored-period",
  "month-align-today",
  "month-custom-hidden",
  "settings-hidden",
] as const;

export type NavigationScenario = (typeof navigationScenarios)[number];

export const navigationFixture = (
  theme: "light" | "dark",
  width: number,
  scenario: NavigationScenario
): AppModel => {
  const original = fixtureModel();

  let model: AppModel = {
    ...original,
    calendar: {
      ...original.calendar,
      navigation: { ...original.calendar.navigation, weekStartsOn: 1 },
      selected: visibleEvents(original)
        .filter((event) =>
          ["a-review", "late", "week-project"].includes(event.source.eventId)
        )
        .map((event) => event.key),
      viewportWidth: width - (width <= 1000 ? 185 : 220),
    },
    settings: { ...original.settings, hideContextPanel: true, theme },
  };

  if (
    [
      "week-hidden",
      "week-hidden-weekends",
      "month-custom-hidden",
      "settings-hidden",
    ].includes(scenario)
  ) {
    for (const value of [2, 4]) {
      ({ model } = update(
        model,
        Message.ChangedSettings({
          change: SettingsChange.cases.Weekday.make({ shown: false, value }),
        })
      ));
    }
  }

  if (scenario === "week-hidden-weekends") {
    ({ model } = update(model, Message.ClickedWeekends()));
  }

  if (
    ["month-align-today", "month-custom-hidden", "restored-period"].includes(
      scenario
    )
  ) {
    ({ model } = update(
      model,
      Message.ClickedView({ days: 7, mode: "month" })
    ));
  }

  if (scenario === "restored-period") {
    ({ model } = update(model, Message.ClickedView({ days: 7, mode: "week" })));
  }

  if (scenario === "month-align-today") {
    ({ model } = update(model, Message.ClickedAlignToday()));
  }

  if (scenario === "settings-hidden") {
    model = { ...model, route: SettingsRoute.make({ page: "general" }) };
  }

  return {
    ...model,
    calendar: { ...model.calendar, reads: original.calendar.reads },
  };
};
