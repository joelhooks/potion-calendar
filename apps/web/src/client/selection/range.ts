import { Option } from "effect";

import { monthGeometry, monthMetrics } from "../../layout/month.js";
import { partsFromDay, visibleDays } from "../../layout/navigation.js";
import type { AppModel } from "../app.js";
import { monthHostKey, monthInitialPosition } from "../month/host.js";

export const selectionRangeDays = (model: AppModel): readonly number[] => {
  if (model.calendar.navigation.mode !== "month") {
    return visibleDays(model.calendar.navigation);
  }

  const { rowHeight } = monthGeometry(
    model.calendar.viewport,
    model.settings.showWeekNumbers
  );

  if (rowHeight <= 0) {
    return [];
  }

  const settled = Option.getOrUndefined(model.month.settled);

  const position =
    settled !== undefined &&
    Option.contains(monthHostKey(model), settled.session.hostKey)
      ? (settled.position ?? monthInitialPosition(model))
      : monthInitialPosition(model);

  const rowPosition = position.scrollTop / rowHeight;
  const row = Math.floor(rowPosition);
  const first = position.firstWeek + row * 7;

  const count = monthMetrics.weekCount + Number(rowPosition > row);

  return Array.from({ length: count * 7 }, (_, index) => first + index).filter(
    (day) => {
      const weekday = partsFromDay(day).weekDay;

      return (
        !model.calendar.navigation.hideWeekends ||
        (weekday !== 0 && weekday !== 6)
      );
    }
  );
};
