import { Option, Result, Schema } from "effect";

import {
  clampDisplayDay,
  isDisplayDay,
  maximumDisplayedDays,
  partsFromDay,
  weekStart,
} from "./calendar-day.js";
import type { Navigation } from "./navigation.js";

export const Weekday = Schema.Int.check(
  Schema.isBetween({ maximum: 6, minimum: 0 })
);

export const HiddenWeekdays = Schema.UniqueArray(Weekday).check(
  Schema.isMaxLength(6)
);

const CalendarDay = Schema.Int.check(Schema.makeFilter(isDisplayDay));

export const TimePeriod = Schema.Struct({
  anchor: CalendarDay,
  days: Schema.Int.check(
    Schema.isBetween({ maximum: maximumDisplayedDays, minimum: 1 })
  ),
  mode: Schema.Literals(["day", "week", "days"]),
});

export const TimeVisibility = Schema.Struct({
  hidden: HiddenWeekdays,
  period: TimePeriod,
});

export const WeekdayVisibilityAction = Schema.TaggedUnion({
  Hide: { weekday: Weekday },
  Show: { weekday: Weekday },
  Weekends: { hidden: Schema.Boolean },
});

export class LastVisibleWeekday extends Schema.TaggedError<LastVisibleWeekday>()(
  "LastVisibleWeekday",
  { requested: Schema.UniqueArray(Weekday) }
) {}

export const navigationRefinementContract = {
  gaps: [
    "HiddenWeekdayPersistence",
    "ArbitraryHiddenMonthGeometry",
    "SeparatePreviousPeriodAction",
  ],
  lastVisibleWeekdayPolicy:
    "desk default: last visible weekday cannot be hidden (spec silent)",
} as const;

const bothWeekendsHidden = (hidden: ReadonlySet<number>): boolean =>
  hidden.has(0) && hidden.has(6);

const bothWeekendsShown = (hidden: ReadonlySet<number>): boolean =>
  !hidden.has(0) && !hidden.has(6);

export const changeWeekdayVisibility = (
  current: typeof TimeVisibility.Type,
  action: typeof WeekdayVisibilityAction.Type
): Result.Result<typeof TimeVisibility.Type, LastVisibleWeekday> => {
  const previous = new Set(current.hidden);
  const next = new Set(current.hidden);

  const requested = WeekdayVisibilityAction.match(action, {
    Hide: ({ weekday }) => {
      next.add(weekday);

      return [weekday];
    },
    Show: ({ weekday }) => {
      next.delete(weekday);

      return [];
    },
    Weekends: ({ hidden }) => {
      for (const day of [0, 6]) {
        if (hidden) {
          next.add(day);
        } else {
          next.delete(day);
        }
      }

      return hidden ? [0, 6] : [];
    },
  });

  if (next.size === 7) {
    return Result.fail(new LastVisibleWeekday({ requested }));
  }

  let { days } = current.period;

  if (current.period.mode === "days") {
    if (
      days === 7 &&
      !bothWeekendsHidden(previous) &&
      bothWeekendsHidden(next)
    ) {
      days = 5;
    } else if (
      days === 5 &&
      !bothWeekendsShown(previous) &&
      bothWeekendsShown(next)
    ) {
      days = 7;
    }
  }

  return Result.succeed(
    TimeVisibility.make({
      hidden: [...next].toSorted((left, right) => left - right),
      period: TimePeriod.make({ ...current.period, days }),
    })
  );
};

export const displayedTimeDays = (
  period: typeof TimePeriod.Type,
  hidden: typeof HiddenWeekdays.Type,
  startsOn = 0
): readonly number[] => {
  const start =
    period.mode === "week" ? weekStart(period.anchor, startsOn) : period.anchor;

  const target = period.mode === "day" ? 1 : period.days;
  const end = period.mode === "week" ? start + 7 : start + target * 7;
  const excluded = new Set(hidden);
  const result: number[] = [];

  for (let day = start; day < end; day += 1) {
    if (period.mode !== "week" && result.length === target) {
      break;
    }

    if (isDisplayDay(day) && !excluded.has(partsFromDay(day).weekDay)) {
      result.push(day);
    }
  }

  return result;
};

export const pageTimePeriod = (
  period: typeof TimePeriod.Type,
  hidden: typeof HiddenWeekdays.Type,
  direction: -1 | 1,
  startsOn = 0
): typeof TimePeriod.Type => {
  if (period.mode === "week") {
    return TimePeriod.make({
      ...period,
      anchor: clampDisplayDay(period.anchor + direction * 7),
    });
  }

  const excluded = new Set(hidden);
  let anchor = displayedTimeDays(period, hidden, startsOn)[0] ?? period.anchor;
  const count = period.mode === "day" ? 1 : period.days;

  for (let moved = 0; moved < count; moved += 1) {
    do {
      anchor += direction;
    } while (excluded.has(partsFromDay(anchor).weekDay));
  }

  return TimePeriod.make({
    ...period,
    anchor: clampDisplayDay(anchor),
  });
};

export const rememberTimePeriod = (
  navigation: Navigation,
  previous: Option.Option<typeof TimePeriod.Type>
): Option.Option<typeof TimePeriod.Type> =>
  navigation.mode === "month"
    ? previous
    : Option.some(
        TimePeriod.make({
          anchor: navigation.anchor,
          days: navigation.days,
          mode: navigation.mode,
        })
      );

export const restoreTimePeriod = (
  navigation: Navigation,
  previous: Option.Option<typeof TimePeriod.Type>
): Option.Option<Navigation> =>
  navigation.mode === "month"
    ? previous.pipe(Option.map((period) => ({ ...navigation, ...period })))
    : Option.none();

export const MonthTodayIntent = Schema.Literals(["GoToToday", "AlignToday"]);

export const MonthTodayTarget = Schema.Struct({
  anchor: CalendarDay,
  firstWeek: Schema.Int,
});

export const monthTodayTarget = (
  today: number,
  startsOn: typeof Weekday.Type,
  intent: typeof MonthTodayIntent.Type
): typeof MonthTodayTarget.Type => {
  const day = clampDisplayDay(today);
  const anchor = intent === "GoToToday" ? day - partsFromDay(day).day + 1 : day;

  return MonthTodayTarget.make({
    anchor,
    firstWeek: weekStart(anchor, startsOn),
  });
};
