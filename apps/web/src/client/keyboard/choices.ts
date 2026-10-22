import { Option } from "effect";

import { dateChoiceLabel, parseGoToDate } from "../../layout/go-to-date.js";
import { dayInZone, maximumDisplayedDays } from "../../layout/navigation.js";
import type { AppModel } from "../app.js";
import { eventZoneChoices } from "../editing/zone-choices.js";
import { Message } from "../message.js";
import type { AppMessage } from "../message.js";
import { SettingsChange } from "../settings/model.js";
import { weekdayChoices, weekdayNames } from "../settings/weekday-choices.js";
import { timeZoneChoices } from "../time-zones/choices.js";
import { displayedKeyTokens } from "./hints.js";
import {
  actionCatalog,
  availableEventColors,
  selectedColorEvent,
} from "./registry.js";
import type { KeyboardAction, CommandSection } from "./registry.js";

export const similarity = (left: string, right: string): number => {
  const a = left.toLowerCase().trim();
  const b = right.toLowerCase().trim();

  if (a === b) {
    return 1;
  }

  if (a.length === 0 || b.length === 0) {
    return 0;
  }

  let row = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];

    for (let j = 1; j <= b.length; j += 1) {
      next.push(
        Math.min(
          (next[j - 1] ?? 0) + 1,
          (row[j] ?? 0) + 1,
          (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
        )
      );
    }

    row = next;
  }

  return 1 - (row[b.length] ?? 0) / Math.max(a.length, b.length);
};

const textScore = (text: string, query: string): number => {
  const value = text.toLowerCase();

  if (value === query) {
    return 1;
  }

  if (value.includes(query)) {
    return 0.9;
  }

  const fuzzy = Math.max(
    similarity(value, query),
    ...value.split(/\s+/u).map((word) => similarity(word, query))
  );

  return fuzzy >= 0.6 ? fuzzy * 0.8 : 0;
};

export const actionScore = (action: KeyboardAction, input: string): number => {
  const query = input.trim().toLowerCase();

  return query === ""
    ? 1
    : Math.max(
        textScore(action.title, query),
        textScore(action.exact ?? "", query),
        ...action.keywords.map(
          (keyword) => textScore(keyword.text, query) * keyword.weight
        )
      );
};

export const shortcutMatches = (
  action: KeyboardAction,
  input: string
): boolean => {
  const query = input.trim().toLowerCase();

  return (
    query === "" ||
    action.keys.some((key) =>
      displayedKeyTokens(key).some((token) => token.toLowerCase() === query)
    ) ||
    [
      action.title,
      ...action.title.split(/\s+/u),
      ...action.keywords.flatMap((keyword) => [
        keyword.text,
        ...keyword.text.split(/\s+/u),
      ]),
    ].some((text) => similarity(text, query) >= 0.85)
  );
};

export interface CommandChoice {
  readonly id: string;
  readonly title: string;
  readonly section: CommandSection;
  readonly keys: readonly string[];
  readonly disabled: boolean;
  readonly exact: boolean;
  readonly score: number;
  readonly message: AppMessage;
}

export const commandSections: readonly CommandSection[] = [
  "Event",
  "Calendar",
  "Navigation",
  "Time zones",
  "App",
  "Calendars",
  "View",
  "Settings & help",
  "Accounts",
  "Search",
];

const dayChoice = (day: number): CommandChoice => ({
  disabled: false,
  exact: true,
  id: `display-${day}`,
  keys: [],
  message: Message.ClickedView({ days: day, mode: day === 1 ? "day" : "days" }),
  score: 1,
  section: "View",
  title: `Display ${day} day${day === 1 ? "" : "s"}`,
});

const filterSubchoices = (
  choices: readonly CommandChoice[],
  query: string
): readonly CommandChoice[] =>
  choices.flatMap((choice) => {
    const score =
      query === "" ? 1 : textScore(choice.title.toLowerCase(), query);

    return score > 0
      ? [
          {
            ...choice,
            exact: query !== "" && choice.title.toLowerCase() === query,
            score,
          },
        ]
      : [];
  });

const preferenceChoices = (
  model: AppModel,
  query: string
): readonly CommandChoice[] => {
  const enabled =
    actionCatalog(model)
      .find((action) => action.id === model.keyboard.screen)
      ?.availability(model) === "enabled";

  const themes = [
    { title: "Auto", value: "auto" },
    { title: "Light mode", value: "light" },
    { title: "Dark mode", value: "dark" },
  ] satisfies readonly {
    readonly title: string;
    readonly value: "auto" | "light" | "dark";
  }[];

  return filterSubchoices(
    model.keyboard.screen === "theme"
      ? themes.map(({ title, value }): CommandChoice => ({
          disabled: !enabled,
          exact: false,
          id: `theme-${value}`,
          keys: [],
          message: Message.ChangedSettings({
            change: SettingsChange.cases.Theme.make({ value }),
          }),
          score: 1,
          section: "Settings & help",
          title,
        }))
      : weekdayNames.flatMap((title, value): readonly CommandChoice[] =>
          value === (model.calendar.navigation.weekStartsOn ?? 0)
            ? []
            : [
                {
                  disabled: !enabled,
                  exact: false,
                  id: `week-start-${value}`,
                  keys: [],
                  message: Message.ChangedSettings({
                    change: SettingsChange.cases.WeekStart.make({ value }),
                  }),
                  score: 1,
                  section: "View",
                  title,
                },
              ]
        ),
    query
  );
};

const colorChoices = (
  model: AppModel,
  query: string
): readonly CommandChoice[] =>
  filterSubchoices(
    [
      { title: "Use calendar color", value: "calendar" },
      ...availableEventColors(model).map((color) => ({
        title: color.name,
        value: color.google,
      })),
    ].map(({ title, value }): CommandChoice => ({
      disabled: selectedColorEvent(model) === undefined,
      exact: false,
      id: `color-${value}`,
      keys: [],
      message: Message.KeyboardAction({ id: `color:${value}` }),
      score: 1,
      section: "Event",
      title,
    })),
    query
  );

const buildCommandChoices = (model: AppModel): readonly CommandChoice[] => {
  const query = model.keyboard.query.trim().toLowerCase();

  if (
    model.keyboard.screen === "theme" ||
    model.keyboard.screen === "week-start"
  ) {
    return preferenceChoices(model, query);
  }

  if (model.keyboard.screen === "colors") {
    return colorChoices(model, query);
  }

  if (model.keyboard.screen === "event-zone") {
    return eventZoneChoices(model);
  }

  if (model.keyboard.screen === "zones") {
    return timeZoneChoices(model);
  }

  if (model.keyboard.screen === "weekdays") {
    return weekdayChoices(model);
  }

  if (model.keyboard.screen === "days") {
    return Array.from({ length: maximumDisplayedDays }, (_, index) => index + 1)
      .filter((day) => query === "" || String(day) === query)
      .map(dayChoice);
  }

  if (model.keyboard.screen === "date") {
    const today = dayInZone(model.calendar.now, model.calendar.zone);
    const day = parseGoToDate(query, today);

    return day === undefined
      ? []
      : [
          {
            disabled: false,
            exact: true,
            id: `date-${day}`,
            keys: [],
            message: Message.KeyboardDate({ day, flash: true }),
            score: 1,
            section: "Navigation",
            title: dateChoiceLabel(day, today),
          },
        ];
  }

  const choices = actionCatalog(model)
    .filter(
      (action) =>
        action.menu !== false &&
        !["hidden", "shortcut-only"].includes(action.availability(model))
    )
    .map((action): CommandChoice => ({
      disabled: action.availability(model) !== "enabled",
      exact:
        query !== "" &&
        [action.title.toLowerCase(), action.exact].includes(query),
      id: action.id,
      keys: action.keys,
      message: action.dispatch(model),
      score: actionScore(action, query),
      section: action.commandSection,
      title: action.title,
    }))
    .filter((choice) => choice.score > 0);

  if (/^(?:[1-9]|[12]\d|3[01])$/u.test(query)) {
    choices.push(dayChoice(Number(query)));
  }

  if (
    query !== "" &&
    Option.isSome(model.person) &&
    actionCatalog(model)
      .find((action) => action.id === "search-events")
      ?.availability(model) === "enabled"
  ) {
    choices.push({
      disabled: false,
      exact: false,
      id: "search-query",
      keys: [],
      message: Message.SearchOpened({
        query: Option.some(model.keyboard.query.trim()),
      }),
      score: 0.01,
      section: "Search",
      title: `Search events for “${model.keyboard.query.trim()}”`,
    });
  }

  return commandSections.flatMap((section) => {
    const entries = choices.filter((choice) => choice.section === section);

    return query === ""
      ? entries
      : entries.toSorted(
          (a, b) => b.score - a.score || a.title.localeCompare(b.title)
        );
  });
};

interface CommandProjection {
  readonly timeZones: AppModel["timeZones"];
  readonly action: AppModel["action"];
  readonly choices: readonly CommandChoice[];
  readonly cursor: AppModel["keyboard"]["cursor"];
  readonly editing: AppModel["editing"];
  readonly person: AppModel["person"];
  readonly query: string;
  readonly screen: AppModel["keyboard"]["screen"];
  readonly searchResponse: AppModel["search"]["response"];
  readonly session: AppModel["session"];
}

const commandProjection = new WeakMap<
  AppModel["calendar"],
  CommandProjection
>();

export const commandChoices = (model: AppModel): readonly CommandChoice[] => {
  const cached = commandProjection.get(model.calendar);

  if (
    cached?.editing === model.editing &&
    cached.timeZones === model.timeZones &&
    cached.person === model.person &&
    cached.session === model.session &&
    cached.action === model.action &&
    cached.query === model.keyboard.query &&
    cached.screen === model.keyboard.screen &&
    cached.searchResponse === model.search.response &&
    cached.cursor === model.keyboard.cursor
  ) {
    return cached.choices;
  }

  const choices = buildCommandChoices(model);
  commandProjection.set(model.calendar, {
    action: model.action,
    choices,
    cursor: model.keyboard.cursor,
    editing: model.editing,
    person: model.person,
    query: model.keyboard.query,
    screen: model.keyboard.screen,
    searchResponse: model.search.response,
    session: model.session,
    timeZones: model.timeZones,
  });

  return choices;
};

export const selectedChoice = (model: AppModel): CommandChoice | undefined => {
  const choices = commandChoices(model).filter((choice) => !choice.disabled);

  return (
    choices.find((choice) => choice.id === model.keyboard.highlighted) ??
    choices[0]
  );
};

export const enterChoice = (model: AppModel): CommandChoice | undefined =>
  commandChoices(model).find((choice) => choice.exact && !choice.disabled) ??
  selectedChoice(model);

export const moveHighlight = (model: AppModel, direction: -1 | 1): string => {
  const choices = commandChoices(model).filter((choice) => !choice.disabled);

  const index = choices.findIndex(
    (choice) => choice.id === selectedChoice(model)?.id
  );

  return (
    choices[(index + direction + choices.length) % choices.length]?.id ?? ""
  );
};
