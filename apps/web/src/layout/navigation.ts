import { DateTime, Schema } from "effect";

const dayMillis = 86_400_000;

export const dayFromIso = (iso: string): number =>
  Math.floor(DateTime.toEpochMillis(DateTime.makeUnsafe(iso)) / dayMillis);

export const isoFromDay = (day: number): string =>
  DateTime.formatIsoDateUtc(DateTime.makeUnsafe(day * dayMillis));

export const partsFromDay = (
  day: number
): ReturnType<typeof DateTime.toPartsUtc> =>
  DateTime.toPartsUtc(DateTime.makeUnsafe(day * dayMillis));

export const dayInZone = (instant: number, zone: string): number => {
  const { year, month, day } = DateTime.toParts(
    DateTime.makeZonedUnsafe(instant, { timeZone: zone })
  );

  return dayFromIso(
    DateTime.formatIsoDateUtc(DateTime.makeUnsafe({ day, month, year }))
  );
};

export const midnightInZone = (day: number, zone: string): string =>
  DateTime.formatIso(
    DateTime.makeZonedUnsafe(`${isoFromDay(day)}T00:00:00.000Z`, {
      adjustForTimeZone: true,
      timeZone: zone,
    })
  );

export const NavigationState = Schema.Struct({
  anchor: Schema.Int,
  days: Schema.Int,
  hideWeekends: Schema.Boolean,
  mode: Schema.Literals(["day", "week", "days", "month"]),
});

export type Navigation = typeof NavigationState.Type;

export type NavigationAction =
  | { readonly type: "page"; readonly direction: -1 | 1 }
  | { readonly type: "today" }
  | { readonly type: "date"; readonly day: number }
  | { readonly type: "weekends" }
  | {
      readonly type: "view";
      readonly mode: Navigation["mode"];
      readonly days?: number;
    };

const minimum = dayFromIso("2015-01-01");

const maximum = dayFromIso("2040-12-31");

const clampDay = (day: number): number =>
  Math.max(minimum, Math.min(maximum, day));

const weekStart = (day: number): number => day - partsFromDay(day).weekDay;

const monthStart = (day: number): number => day - partsFromDay(day).day + 1;

export const initialNavigation = (today: number): Navigation => ({
  anchor: clampDay(today),
  days: 7,
  hideWeekends: false,
  mode: "week",
});

export const periodStart = (nav: Navigation): number => {
  if (nav.mode === "month") {
    return weekStart(monthStart(nav.anchor));
  }

  return nav.mode === "week" ? weekStart(nav.anchor) : nav.anchor;
};

export const visibleDays = (nav: Navigation): readonly number[] => {
  const start = periodStart(nav);
  const fixedPeriod = nav.mode === "week" || nav.mode === "month";
  const target = nav.mode === "day" ? 1 : nav.days;
  const length = nav.mode === "month" ? 42 : 7;
  const result: number[] = [];

  for (let day = start; day <= maximum; day += 1) {
    if (fixedPeriod ? day >= start + length : result.length >= target) {
      break;
    }

    const weekday = partsFromDay(day).weekDay;

    if (
      day >= minimum &&
      (!nav.hideWeekends || (weekday !== 0 && weekday !== 6))
    ) {
      result.push(day);
    }
  }

  return result;
};

const weekendDayCount = (days: number, hidden: boolean): number => {
  if (hidden && days === 7) {
    return 5;
  }

  if (!hidden && days === 5) {
    return 7;
  }

  return days;
};

export const navigate = (
  nav: Navigation,
  action: NavigationAction,
  today: number
): Navigation => {
  switch (action.type) {
    case "date": {
      return { ...nav, anchor: clampDay(action.day) };
    }

    case "today": {
      return { ...nav, anchor: clampDay(today) };
    }

    case "weekends": {
      return {
        ...nav,
        days:
          nav.mode === "days"
            ? weekendDayCount(nav.days, !nav.hideWeekends)
            : nav.days,
        hideWeekends: !nav.hideWeekends,
      };
    }

    case "view": {
      const start = periodStart(nav);
      const containsToday = visibleDays(nav).includes(today);

      return {
        ...nav,
        anchor: action.mode === "day" && containsToday ? today : start,
        days: Math.max(1, Math.min(9, action.days ?? nav.days)),
        mode: action.mode === "days" && action.days === 1 ? "day" : action.mode,
      };
    }

    case "page": {
      if (nav.mode === "month") {
        const next = DateTime.add(
          DateTime.makeUnsafe(
            `${isoFromDay(monthStart(nav.anchor))}T00:00:00Z`
          ),
          {
            months: action.direction,
          }
        );

        return {
          ...nav,
          anchor: clampDay(dayFromIso(DateTime.formatIsoDateUtc(next))),
        };
      }

      if (nav.mode === "week") {
        return { ...nav, anchor: clampDay(nav.anchor + action.direction * 7) };
      }

      let anchor = visibleDays(nav)[0] ?? nav.anchor;
      const count = nav.mode === "day" ? 1 : nav.days;

      for (let moved = 0; moved < count; moved += 1) {
        anchor += action.direction;

        while (
          nav.hideWeekends &&
          [0, 6].includes(partsFromDay(anchor).weekDay)
        ) {
          anchor += action.direction;
        }
      }

      return { ...nav, anchor: clampDay(anchor) };
    }

    default: {
      return nav;
    }
  }
};

export const keyAction = (key: string): NavigationAction | undefined => {
  switch (key.toLowerCase()) {
    case "t": {
      return { type: "today" };
    }

    case "d":
    case "1": {
      return { mode: "day", type: "view" };
    }

    case "w":
    case "0": {
      return { mode: "week", type: "view" };
    }

    case "m": {
      return { mode: "month", type: "view" };
    }

    case "arrowright": {
      return { direction: 1, type: "page" };
    }

    case "arrowleft": {
      return { direction: -1, type: "page" };
    }

    default: {
      return /^[2-9]$/u.test(key)
        ? { days: Number(key), mode: "days", type: "view" }
        : undefined;
    }
  }
};
