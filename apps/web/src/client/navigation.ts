import { Option } from "effect";

import { monthGeometry } from "../layout/month.js";
import {
  monthTodayTarget,
  rememberTimePeriod,
  restoreTimePeriod,
} from "../layout/navigation-refinements.js";
import {
  dayInZone,
  navigate,
  partsFromDay,
  periodStart,
  weekStart,
} from "../layout/navigation.js";
import type { NavigationAction } from "../layout/navigation.js";
import type { AppModel } from "./app.js";
import {
  monthHostKey,
  monthInitialPosition,
  monthNavigation,
} from "./month/host.js";

export const visibleMonthStart = (model: AppModel): number => {
  const settled = Option.getOrUndefined(model.month.settled);

  const position =
    settled !== undefined &&
    Option.contains(monthHostKey(model), settled.session.hostKey)
      ? (settled.position ?? monthInitialPosition(model))
      : monthInitialPosition(model);

  const { rowHeight } = monthGeometry(
    model.calendar.viewport,
    model.settings.showWeekNumbers
  );

  return position.firstWeek + Math.floor(position.scrollTop / rowHeight) * 7;
};

export const navigationTransition = (
  model: AppModel,
  action: NavigationAction
): AppModel => {
  const current = monthNavigation(model);
  const today = dayInZone(model.calendar.now, model.calendar.zone);
  let navigation = navigate(current, action, today);
  let { previousTimePeriod } = model.calendar;

  if (
    action.type === "view" &&
    current.mode !== "month" &&
    action.mode === "month"
  ) {
    previousTimePeriod = rememberTimePeriod(current, previousTimePeriod);
  }

  if (
    action.type === "view" &&
    current.mode === "month" &&
    action.mode !== "month"
  ) {
    const restored = restoreTimePeriod(current, previousTimePeriod);
    const first = visibleMonthStart(model);

    if (Option.isSome(restored)) {
      const start = periodStart(restored.value);

      if (start >= first && start < first + 42) {
        navigation = navigate(restored.value, action, today);
      }
    }

    if (
      navigation.mode === "day" &&
      today >= first &&
      today < first + 42 &&
      (!current.hideWeekends || ![0, 6].includes(partsFromDay(today).weekDay))
    ) {
      navigation = { ...navigation, anchor: today };
    }

    previousTimePeriod = Option.none();
  }

  const monthTarget =
    navigation.mode === "month" &&
    (action.type === "today" || action.type === "align")
      ? Option.some(
          monthTodayTarget(
            today,
            navigation.weekStartsOn ?? 0,
            action.type === "today" ? "GoToToday" : "AlignToday"
          ).firstWeek
        )
      : Option.none<number>();

  return {
    ...model,
    calendar: {
      ...model.calendar,
      navigation,
      previousTimePeriod,
      rectangle: Option.none(),
      selected: [],
    },
    month: {
      ...model.month,
      epoch: model.month.epoch + 1,
      firstWeek: monthTarget,
      pending: Option.none(),
    },
  };
};

export const preserveMonthDisplay = (
  before: AppModel,
  next: AppModel
): AppModel => {
  if (
    before.calendar.navigation.mode !== "month" ||
    (before.calendar.navigation.hideWeekends ===
      next.calendar.navigation.hideWeekends &&
      before.calendar.navigation.weekStartsOn ===
        next.calendar.navigation.weekStartsOn &&
      before.settings.showWeekNumbers === next.settings.showWeekNumbers)
  ) {
    return next;
  }

  return {
    ...next,
    calendar: {
      ...next.calendar,
      navigation: {
        ...next.calendar.navigation,
        anchor: monthNavigation(before).anchor,
      },
    },
    month: {
      ...next.month,
      firstWeek: Option.some(
        weekStart(
          visibleMonthStart(before),
          next.calendar.navigation.weekStartsOn
        )
      ),
    },
  };
};
