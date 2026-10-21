import { CalendarRef } from "@calendar/calendar/contracts";
import { Option, Schema } from "effect";

import { HiddenWeekdays } from "../../layout/navigation-refinements.js";
import {
  ZonePreferences,
  normalizeZonePreferences,
} from "../../layout/time-zones.js";
import { VisibilityChoices, VisibilityMigration } from "./visibility-model.js";

export const TimeFormat = Schema.Literals(["system", "12", "24"]);

export const Theme = Schema.Literals(["auto", "light", "dark"]);

export const TodayAction = Schema.Literals(["today", "align"]);

export const UpcomingMeetingMinutes = Schema.Literals([
  30, 60, 240, 480, 720, 10_080,
]);

export const WeekStart = Schema.Int.check(
  Schema.isBetween({ maximum: 6, minimum: 0 })
);

export const SettingsChange = Schema.TaggedUnion({
  ContextPanel: { shown: Schema.Boolean },
  Declined: { shown: Schema.Boolean },
  DefaultCalendar: { value: Schema.Option(CalendarRef) },
  EventInvites: { enabled: Schema.Boolean },
  Theme: { value: Theme },
  TimeFormat: { value: TimeFormat },
  TodayAction: { value: TodayAction },
  UpcomingMeeting: { minutes: UpcomingMeetingMinutes },
  WeekNumbers: { shown: Schema.Boolean },
  WeekStart: { value: WeekStart },
  Weekday: { shown: Schema.Boolean, value: WeekStart },
  Weekends: { shown: Schema.Boolean },
});

export const SettingsUi = Schema.Struct({
  defaultCalendar: Schema.Option(CalendarRef),
  eventInvites: Schema.Boolean,
  hideContextPanel: Schema.Boolean,
  showWeekNumbers: Schema.Boolean,
  system24Hour: Schema.Boolean,
  systemDark: Schema.Boolean,
  theme: Theme,
  timeFormat: TimeFormat,
  todayAction: TodayAction,
  upcomingMeetingMinutes: UpcomingMeetingMinutes,
});

export const initialSettings = (): typeof SettingsUi.Type => ({
  defaultCalendar: Option.none(),
  eventInvites: true,
  hideContextPanel: false,
  showWeekNumbers: false,
  system24Hour: false,
  systemDark: false,
  theme: "auto",
  timeFormat: "system",
  todayAction: "today",
  upcomingMeetingMinutes: 240,
});

export const SavedPreferences = Schema.Struct({
  defaultCalendar: Schema.optionalKey(CalendarRef),
  eventInvites: Schema.Boolean,
  hiddenWeekdays: Schema.optionalKey(HiddenWeekdays),
  hideContextPanel: Schema.optionalKey(Schema.Boolean),
  hideDeclined: Schema.Boolean,
  hideWeekends: Schema.Boolean,
  mergeDuplicates: Schema.Boolean,
  showWeekNumbers: Schema.Boolean,
  theme: Theme,
  timeFormat: TimeFormat,
  todayAction: TodayAction,
  upcomingMeetingMinutes: Schema.optionalKey(UpcomingMeetingMinutes),
  version: Schema.Literal(2),
  visibility: VisibilityChoices,
  visibilityMigration: Schema.optionalKey(VisibilityMigration),
  weekStartsOn: WeekStart,
  zones: Schema.optionalKey(ZonePreferences),
});

const StoredCommon = {
  defaultCalendar: Schema.optionalKey(CalendarRef),
  eventInvites: Schema.optionalKey(Schema.Boolean),
  hiddenWeekdays: Schema.optionalKey(HiddenWeekdays),
  hideContextPanel: Schema.optionalKey(Schema.Boolean),
  hideDeclined: Schema.optionalKey(Schema.Boolean),
  hideWeekends: Schema.optionalKey(Schema.Boolean),
  mergeDuplicates: Schema.optionalKey(Schema.Boolean),
  showWeekNumbers: Schema.optionalKey(Schema.Boolean),
  theme: Schema.optionalKey(Theme),
  timeFormat: Schema.optionalKey(TimeFormat),
  todayAction: Schema.optionalKey(TodayAction),
  upcomingMeetingMinutes: Schema.optionalKey(UpcomingMeetingMinutes),
  weekStartsOn: Schema.optionalKey(WeekStart),
  zones: Schema.optionalKey(ZonePreferences),
};

export const StoredPreferences = Schema.Union([
  Schema.Struct({
    ...StoredCommon,
    hidden: Schema.Array(Schema.String),
    version: Schema.optionalKey(Schema.Literal(1)),
  }),
  Schema.Struct({
    ...StoredCommon,
    version: Schema.Literal(2),
    visibility: VisibilityChoices,
    visibilityMigration: Schema.optionalKey(VisibilityMigration),
  }),
]);

export const normalizePreferences = (
  stored: typeof StoredPreferences.Type
): typeof SavedPreferences.Type => {
  const preferences: typeof SavedPreferences.Type = {
    eventInvites: stored.eventInvites ?? true,
    hiddenWeekdays:
      stored.hiddenWeekdays ?? ((stored.hideWeekends ?? false) ? [0, 6] : []),
    hideContextPanel: stored.hideContextPanel ?? false,
    hideDeclined: stored.hideDeclined ?? false,
    hideWeekends: stored.hideWeekends ?? false,
    mergeDuplicates: stored.mergeDuplicates ?? true,
    showWeekNumbers: stored.showWeekNumbers ?? false,
    theme: stored.theme ?? "auto",
    timeFormat: stored.timeFormat ?? "system",
    todayAction: stored.todayAction ?? "today",
    upcomingMeetingMinutes: stored.upcomingMeetingMinutes ?? 240,
    version: 2,
    visibility:
      "hidden" in stored
        ? Object.fromEntries(stored.hidden.map((key) => [key, false]))
        : stored.visibility,
    weekStartsOn: stored.weekStartsOn ?? 0,
  };

  const migration =
    "hidden" in stored
      ? VisibilityMigration.cases.Legacy.make({})
      : stored.visibilityMigration;

  const migrated =
    migration === undefined
      ? preferences
      : { ...preferences, visibilityMigration: migration };

  const withZones =
    stored.zones === undefined
      ? migrated
      : { ...migrated, zones: normalizeZonePreferences(stored.zones) };

  return stored.defaultCalendar === undefined
    ? withZones
    : { ...withZones, defaultCalendar: stored.defaultCalendar };
};

export const resolvedTheme = (model: {
  readonly settings: typeof SettingsUi.Type;
}): "light" | "dark" => {
  if (model.settings.theme !== "auto") {
    return model.settings.theme;
  }

  return model.settings.systemDark ? "dark" : "light";
};
