import { Option, Predicate } from "effect";
import { AsyncData } from "foldkit";

import {
  initialMonthPosition,
  MonthWindowFrame,
} from "../../layout/month-window.js";
import { monthGeometry, monthWeeks } from "../../layout/month.js";
import type { AppModel } from "../app.js";

export const monthHostKey = (model: AppModel): Option.Option<string> => {
  const session = Option.getOrUndefined(AsyncData.getData(model.session));

  return session !== undefined &&
    session !== null &&
    Option.contains(model.person, session.user.id) &&
    model.action === "idle" &&
    Predicate.isTagged(model.route, "Calendar") &&
    model.calendar.navigation.mode === "month"
    ? Option.some(
        JSON.stringify([
          session.user.id,
          model.clipboard.epoch,
          model.month.epoch,
          {
            anchor: model.calendar.navigation.anchor,
            days: model.calendar.navigation.days,
            hideWeekends: model.calendar.navigation.hideWeekends,
            mode: model.calendar.navigation.mode,
            weekStartsOn: model.calendar.navigation.weekStartsOn,
          },
          model.calendar.zone,
          model.calendar.viewport,
          model.calendar.viewportWidth,
          model.settings.showWeekNumbers,
        ])
      )
    : Option.none();
};

export const monthNavigation = (model: AppModel) => {
  const settled = Option.getOrUndefined(model.month.settled);

  return settled !== undefined &&
    Option.contains(monthHostKey(model), settled.session.hostKey)
    ? { ...model.calendar.navigation, anchor: settled.anchor }
    : model.calendar.navigation;
};

export const monthInitialPosition = (model: AppModel) => {
  const [first] = monthWeeks(model.calendar.navigation);

  return initialMonthPosition(
    Option.getOrElse(
      model.month.firstWeek,
      () => first?.start ?? model.calendar.navigation.anchor
    ),
    monthGeometry(model.calendar.viewport, model.settings.showWeekNumbers)
      .rowHeight
  );
};

export const monthFrame = (model: AppModel): typeof MonthWindowFrame.Type => {
  const current = Option.getOrUndefined(model.month.frame);

  return current !== undefined &&
    Option.contains(monthHostKey(model), current.session.hostKey)
    ? current.frame
    : MonthWindowFrame.make({
        firstWeek: monthInitialPosition(model).firstWeek,
        pinnedWeek: Option.none(),
        revision: 0,
      });
};
