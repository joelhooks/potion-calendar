import { Option } from "effect";
import { AsyncData } from "foldkit";

import { navigate } from "../../layout/navigation.js";
import type { AppModel } from "../app.js";
import { writableCalendar } from "../editing/load-editor.js";
import { activeZone } from "../time-zones/model.js";
import { applyZonePreferences } from "../time-zones/update.js";
import type { SavedPreferences } from "./model.js";
import { SettingsChange } from "./model.js";
import { VisibilityMigration } from "./visibility-model.js";
import { hiddenCalendars, migrateVisibility } from "./visibility.js";

export const defaultCreationCalendar = (model: AppModel) => {
  const eligible = model.calendar.calendars.filter(writableCalendar);
  const chosen = Option.getOrUndefined(model.settings.defaultCalendar);

  return (
    eligible.find(
      (calendar) =>
        calendar.accountId === chosen?.accountId &&
        calendar.calendarId === chosen.calendarId
    ) ??
    eligible.find((calendar) => calendar.primary) ??
    eligible[0]
  );
};

export const preferenceSnapshot = (
  model: AppModel
): typeof SavedPreferences.Type => {
  const base: typeof SavedPreferences.Type = {
    eventInvites: model.settings.eventInvites,
    hideContextPanel: model.settings.hideContextPanel,
    hideDeclined: model.calendar.hideDeclined,
    hideWeekends: model.calendar.navigation.hideWeekends,
    mergeDuplicates: model.calendar.mergeDuplicates,
    showWeekNumbers: model.settings.showWeekNumbers,
    theme: model.settings.theme,
    timeFormat: model.settings.timeFormat,
    todayAction: model.settings.todayAction,
    upcomingMeetingMinutes: model.settings.upcomingMeetingMinutes,
    version: 2,
    visibility: model.calendar.visibility,
    weekStartsOn: model.calendar.navigation.weekStartsOn ?? 0,
    zones: model.timeZones.preferences,
  };

  const withVisibility = VisibilityMigration.guards.Current(
    model.calendar.visibilityMigration
  )
    ? base
    : { ...base, visibilityMigration: model.calendar.visibilityMigration };

  return Option.match(model.settings.defaultCalendar, {
    onNone: () => withVisibility,
    onSome: (defaultCalendar) => ({ ...withVisibility, defaultCalendar }),
  });
};

export const applyPreferences = (
  model: AppModel,
  preferences: typeof SavedPreferences.Type
): AppModel => {
  const timeZones = applyZonePreferences(
    model.timeZones,
    preferences.zones ?? model.timeZones.preferences
  );

  const inventory = Option.getOrUndefined(
    AsyncData.getData(model.calendar.index)
  );

  const initialMigration =
    preferences.visibilityMigration ??
    VisibilityMigration.cases.Current.make({});

  const visibility =
    inventory === undefined
      ? { migration: initialMigration, visibility: preferences.visibility }
      : migrateVisibility(
          inventory,
          preferences.visibility,
          initialMigration,
          inventory.accounts.map((account) => account.accountId)
        );

  return {
    ...model,
    calendar: {
      ...model.calendar,
      hidden: hiddenCalendars(
        model.calendar.calendars,
        visibility.visibility,
        visibility.migration
      ),
      hideDeclined: preferences.hideDeclined,
      mergeDuplicates: preferences.mergeDuplicates,
      navigation: {
        ...model.calendar.navigation,
        hideWeekends: preferences.hideWeekends,
        weekStartsOn: preferences.weekStartsOn,
      },
      visibility: visibility.visibility,
      visibilityMigration: visibility.migration,
      zone: activeZone(timeZones),
    },
    settings: {
      ...model.settings,
      defaultCalendar: Option.fromNullishOr(preferences.defaultCalendar),
      eventInvites: preferences.eventInvites,
      hideContextPanel: preferences.hideContextPanel ?? false,
      showWeekNumbers: preferences.showWeekNumbers,
      theme: preferences.theme,
      timeFormat: preferences.timeFormat,
      todayAction: preferences.todayAction,
      upcomingMeetingMinutes: preferences.upcomingMeetingMinutes ?? 240,
    },
    timeZones,
  };
};

export const changeSettings = (
  model: AppModel,
  change: typeof SettingsChange.Type
): AppModel =>
  SettingsChange.match<AppModel>(change, {
    ContextPanel: ({ shown }) => ({
      ...model,
      settings: { ...model.settings, hideContextPanel: !shown },
    }),
    Declined: ({ shown }) => ({
      ...model,
      calendar: { ...model.calendar, hideDeclined: !shown },
    }),
    DefaultCalendar: ({ value }) => {
      if (
        Option.isSome(value) &&
        !model.calendar.calendars.some(
          (calendar) =>
            calendar.accountId === value.value.accountId &&
            calendar.calendarId === value.value.calendarId &&
            writableCalendar(calendar)
        )
      ) {
        return {
          ...model,
          error: Option.some("Choose a writable calendar for new events."),
        };
      }

      return {
        ...model,
        settings: { ...model.settings, defaultCalendar: value },
      };
    },
    EventInvites: ({ enabled }) => ({
      ...model,
      settings: { ...model.settings, eventInvites: enabled },
    }),
    Theme: ({ value }) => ({
      ...model,
      settings: { ...model.settings, theme: value },
    }),
    TimeFormat: ({ value }) => ({
      ...model,
      settings: { ...model.settings, timeFormat: value },
    }),
    TodayAction: ({ value }) => ({
      ...model,
      settings: { ...model.settings, todayAction: value },
    }),
    UpcomingMeeting: ({ minutes }) => ({
      ...model,
      settings: { ...model.settings, upcomingMeetingMinutes: minutes },
    }),
    WeekNumbers: ({ shown }) => ({
      ...model,
      settings: { ...model.settings, showWeekNumbers: shown },
    }),
    WeekStart: ({ value }) => ({
      ...model,
      calendar: {
        ...model.calendar,
        navigation: { ...model.calendar.navigation, weekStartsOn: value },
      },
    }),
    Weekends: ({ shown }) =>
      shown === !model.calendar.navigation.hideWeekends
        ? model
        : {
            ...model,
            calendar: {
              ...model.calendar,
              navigation: navigate(
                model.calendar.navigation,
                { type: "weekends" },
                model.calendar.navigation.anchor
              ),
            },
          },
  });
