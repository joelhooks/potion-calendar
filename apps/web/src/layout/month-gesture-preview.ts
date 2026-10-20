import { Option } from "effect";

import type { GestureResult } from "../client/editing/gesture-model.js";
import { dayFromIso } from "./navigation.js";

export const monthGesturePreview = (
  preview: Option.Option<typeof GestureResult.Type>,
  weeks: readonly (readonly number[])[]
) => {
  if (Option.isNone(preview) || !preview.value.allDayRow) {
    return [];
  }

  const { range, duplicate } = preview.value;
  const startDay = dayFromIso(range.startDate);

  const endDay =
    dayFromIso(range.endDate) +
    Number(range.allDay || range.endTime !== "00:00");

  return weeks.flatMap((days, row) => {
    const columns = days.flatMap((day, column) =>
      startDay <= day && day < endDay ? [{ column, day }] : []
    );

    if (!range.allDay) {
      return columns.map(({ column, day }) => ({
        allDay: false,
        duplicate,
        endColumn: column + 1,
        endDay: day + 1,
        row,
        startColumn: column,
        startDay: day,
      }));
    }

    const first = columns.at(0);
    const last = columns.at(-1);

    return first === undefined || last === undefined
      ? []
      : [
          {
            allDay: true,
            duplicate,
            endColumn: last.column + 1,
            endDay: last.day + 1,
            row,
            startColumn: first.column,
            startDay: first.day,
          },
        ];
  });
};
