import { DateTime, Result, Schema } from "effect";

import {
  clampDisplayDay,
  dayFromIso,
  displayDayBounds,
  isoFromDay,
  maximumDisplayedDays,
  partsFromDay,
  weekStart,
} from "./calendar-day.js";
import {
  changeWeekdayVisibility,
  displayedTimeDays,
  HiddenWeekdays,
  pageTimePeriod,
  WeekdayVisibilityAction,
} from "./navigation-refinements.js";

export {
  dayFromIso,
  dayInZone,
  displayDayBounds,
  isDisplayDay,
  isoFromDay,
  maximumDisplayedDays,
  midnightInZone,
  partsFromDay,
  weekStart,
} from "./calendar-day.js";

export const NavigationState = Schema.Struct({
  anchor: Schema.Int,
  days: Schema.Int,
  hiddenWeekdays: Schema.optionalKey(HiddenWeekdays),
  hideWeekends: Schema.Boolean,
  mode: Schema.Literals(["day", "week", "days", "month"]),
  weekStartsOn: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 0 }))
  ),
});

export type Navigation = typeof NavigationState.Type;

export const viewLabel = (mode: Navigation["mode"]): string =>
  mode === "days" ? "Custom" : `${mode[0]?.toUpperCase()}${mode.slice(1)}`;

export type NavigationAction =
  | { readonly type: "page"; readonly direction: -1 | 1 }
  | { readonly type: "today" }
  | { readonly type: "align" }
  | { readonly type: "date"; readonly day: number }
  | { readonly type: "weekends" }
  | {
      readonly type: "view";
      readonly mode: Navigation["mode"];
      readonly days?: number;
    };

const monthStart = (day: number): number => day - partsFromDay(day).day + 1;

export const initialNavigation = (today: number): Navigation => ({
  anchor: clampDisplayDay(today),
  days: 7,
  hideWeekends: false,
  mode: "week",
});

export const hiddenTimeWeekdays = (
  nav: Navigation
): typeof HiddenWeekdays.Type =>
  [
    ...new Set([
      ...(nav.hiddenWeekdays ?? []),
      ...(nav.hideWeekends ? [0, 6] : []),
    ]),
  ].toSorted((a, b) => a - b);

export const periodStart = (nav: Navigation): number => {
  if (nav.mode === "month") {
    return weekStart(monthStart(nav.anchor), nav.weekStartsOn);
  }

  return nav.mode === "week"
    ? weekStart(nav.anchor, nav.weekStartsOn)
    : nav.anchor;
};

export const visibleDays = (nav: Navigation): readonly number[] => {
  if (nav.mode !== "month") {
    return displayedTimeDays(
      { anchor: nav.anchor, days: nav.days, mode: nav.mode },
      hiddenTimeWeekdays(nav),
      nav.weekStartsOn
    );
  }

  return Array.from(
    { length: 42 },
    (_, index) => periodStart(nav) + index
  ).filter(
    (day) =>
      day >= displayDayBounds.start &&
      day < displayDayBounds.end &&
      (!nav.hideWeekends || ![0, 6].includes(partsFromDay(day).weekDay))
  );
};

export const navigate = (
  nav: Navigation,
  action: NavigationAction,
  today: number
): Navigation => {
  switch (action.type) {
    case "date": {
      return { ...nav, anchor: clampDisplayDay(action.day) };
    }

    case "today": {
      return {
        ...nav,
        anchor: clampDisplayDay(
          nav.mode === "month" ? monthStart(today) : today
        ),
      };
    }

    case "align": {
      return nav.mode === "month"
        ? { ...nav, anchor: clampDisplayDay(today) }
        : {
            ...nav,
            anchor: clampDisplayDay(today),
            days: Math.max(1, visibleDays(nav).length),
            mode: visibleDays(nav).length <= 1 ? "day" : "days",
          };
    }

    case "weekends": {
      const changed = changeWeekdayVisibility(
        {
          hidden: hiddenTimeWeekdays(nav),
          period: {
            anchor: nav.anchor,
            days: nav.days,
            mode: nav.mode === "month" ? "week" : nav.mode,
          },
        },
        WeekdayVisibilityAction.cases.Weekends.make({
          hidden: !nav.hideWeekends,
        })
      );

      if (Result.isFailure(changed)) {
        return nav;
      }

      const navigation = {
        ...nav,
        days: changed.success.period.days,
        hideWeekends: !nav.hideWeekends,
      };

      return nav.hiddenWeekdays === undefined
        ? navigation
        : { ...navigation, hiddenWeekdays: changed.success.hidden };
    }

    case "view": {
      const start = periodStart(nav);
      const containsToday = visibleDays(nav).includes(today);

      return {
        ...nav,
        anchor: action.mode === "day" && containsToday ? today : start,
        days: Math.max(
          1,
          Math.min(maximumDisplayedDays, action.days ?? nav.days)
        ),
        mode: action.mode === "days" && action.days === 1 ? "day" : action.mode,
      };
    }

    case "page": {
      if (nav.mode === "month") {
        const next = DateTime.add(
          DateTime.makeUnsafe(
            `${isoFromDay(monthStart(nav.anchor))}T00:00:00Z`
          ),
          { months: action.direction }
        );

        return {
          ...nav,
          anchor: clampDisplayDay(dayFromIso(DateTime.formatIsoDateUtc(next))),
        };
      }

      const period = pageTimePeriod(
        { anchor: nav.anchor, days: nav.days, mode: nav.mode },
        hiddenTimeWeekdays(nav),
        action.direction,
        nav.weekStartsOn
      );

      return { ...nav, anchor: period.anchor };
    }

    default: {
      return nav;
    }
  }
};
