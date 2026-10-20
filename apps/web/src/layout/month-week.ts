import { packAllDay } from "./all-day.js";
import type { DisplayEvent } from "./presentation.js";

interface MonthDay {
  readonly day: number;
  readonly enabled: boolean;
}

const order = (a: DisplayEvent, b: DisplayEvent): number =>
  a.startDay - b.startDay ||
  a.startMinute - b.startMinute ||
  b.endDay - a.endDay ||
  b.endMinute - a.endMinute ||
  a.key.localeCompare(b.key);

export const monthWeekLayout = (
  events: readonly DisplayEvent[],
  days: readonly MonthDay[],
  capacity: number
) => {
  const horizontal = events
    .filter(
      (item) =>
        item.allDay &&
        days.some(
          ({ day, enabled }) =>
            enabled && item.startDay <= day && day < item.endDay
        )
    )
    .toSorted(order);

  const priority = new Map(horizontal.map((item, index) => [item.key, index]));

  const spans = horizontal.map((item) => ({
    end:
      days.findLastIndex(
        ({ day, enabled }) =>
          enabled && item.startDay <= day && day < item.endDay
      ) + 1,
    id: item.key,
    start: days.findIndex(
      ({ day, enabled }) => enabled && item.startDay <= day && day < item.endDay
    ),
  }));

  const packed = packAllDay(
    spans,
    new Map(),
    (a, b) => (priority.get(a.id) ?? 0) - (priority.get(b.id) ?? 0)
  );

  const timed = days.map(({ day, enabled }) =>
    enabled
      ? events
          .filter(
            (item) => !item.allDay && item.startDay <= day && day < item.endDay
          )
          .toSorted(order)
      : []
  );

  const occupied = (column: number, placements: typeof packed): number =>
    Math.max(
      0,
      ...placements
        .filter((span) => span.start <= column && column < span.end)
        .map((span) => span.row + 1)
    );

  const rows = Math.max(0, Math.floor(capacity));

  const overflows = timed.some(
    (items, column) => occupied(column, packed) + items.length > rows
  );

  const contentRows = Math.max(0, rows - Number(overflows));
  const visibleSpans = packed.filter((span) => span.row < contentRows);

  const bars = visibleSpans.flatMap((span) => {
    const item = horizontal.find((candidate) => candidate.key === span.id);

    return item === undefined ? [] : [{ ...span, item }];
  });

  const cells = days.map(({ day, enabled }, column) => {
    const startRow = occupied(column, visibleSpans);
    const items = timed[column] ?? [];
    const displayed = items.slice(0, Math.max(0, contentRows - startRow));

    const hiddenBars = packed.filter(
      (span) =>
        span.start <= column && column < span.end && span.row >= contentRows
    ).length;

    return {
      day,
      displayed,
      enabled,
      overflow: hiddenBars + items.length - displayed.length,
      startRow,
    };
  });

  return { bars, cells };
};
