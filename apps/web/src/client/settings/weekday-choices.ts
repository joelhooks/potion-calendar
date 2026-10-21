import { hiddenTimeWeekdays } from "../../layout/navigation.js";
import type { AppModel } from "../app.js";
import type { CommandChoice } from "../keyboard/choices.js";
import { Message } from "../message.js";
import { SettingsChange } from "./model.js";

export const weekdayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const orderedWeekdays = (startsOn: number) =>
  weekdayNames
    .map((name, value) => ({ name, value }))
    .toSorted(
      (a, b) => ((a.value - startsOn + 7) % 7) - ((b.value - startsOn + 7) % 7)
    );

export const weekdayChoices = (model: AppModel): readonly CommandChoice[] => {
  const hidden = hiddenTimeWeekdays(model.calendar.navigation);

  const days = orderedWeekdays(model.calendar.navigation.weekStartsOn ?? 0).map(
    ({ name, value }): CommandChoice => ({
      disabled: hidden.length === 6 && !hidden.includes(value),
      exact: false,
      id: `weekday-${value}`,
      keys: [],
      message: Message.ChangedSettings({
        change: SettingsChange.cases.Weekday.make({
          shown: hidden.includes(value),
          value,
        }),
      }),
      score: 1,
      section: "View",
      title: `${hidden.includes(value) ? "Show" : "Hide"} ${name}`,
    })
  );

  const show = model.calendar.navigation.hideWeekends;

  const choices: readonly CommandChoice[] = [
    ...days,
    {
      disabled:
        !show &&
        hidden.filter((value) => value !== 0 && value !== 6).length === 5,
      exact: false,
      id: "weekday-weekends",
      keys: [],
      message: Message.ChangedSettings({
        change: SettingsChange.cases.Weekends.make({ shown: show }),
      }),
      score: 1,
      section: "View",
      title: `${show ? "Show" : "Hide"} weekends`,
    },
  ];

  return choices.filter(
    (choice) =>
      model.keyboard.query.trim() === "" ||
      choice.title
        .toLowerCase()
        .includes(model.keyboard.query.trim().toLowerCase())
  );
};
