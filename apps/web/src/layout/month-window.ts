import { Schema } from "effect";

import { monthMetrics } from "./month-metrics.js";
import {
  displayDayBounds,
  initialNavigation,
  partsFromDay,
  weekStart,
} from "./navigation.js";

export const MonthWindowFrame = Schema.Struct({
  firstWeek: Schema.Int,
  pinnedWeek: Schema.Option(Schema.Int),
  revision: Schema.Int,
});

export const MonthPosition = Schema.Struct({
  firstWeek: Schema.Int,
  scrollTop: Schema.Finite,
});

export const MonthRebase = Schema.Union([
  Schema.TaggedStruct("Unchanged", { position: MonthPosition }),
  Schema.TaggedStruct("Held", { position: MonthPosition }),
  Schema.TaggedStruct("Rebased", { position: MonthPosition, rows: Schema.Int }),
]).pipe(Schema.toTaggedUnion("_tag"));

export const monthWindowWeeks = monthMetrics.weekCount * 3;

export const MonthScrollLimits = Schema.Struct({
  firstWeek: Schema.Int,
  lastWeek: Schema.Int,
});

export const monthScrollLimits = (
  startsOn: number
): typeof MonthScrollLimits.Type => ({
  firstWeek: weekStart(displayDayBounds.start, startsOn),
  lastWeek:
    weekStart(displayDayBounds.end - 1, startsOn) -
    (monthMetrics.weekCount - 1) * 7,
});

export const boundedMonthScrollTop = (
  firstWeek: number,
  scrollTop: number,
  rowHeight: number,
  limits: typeof MonthScrollLimits.Type
): number =>
  rowHeight <= 0
    ? 0
    : Math.max(
        0,
        ((limits.firstWeek - firstWeek) * rowHeight) / 7,
        Math.min(scrollTop, ((limits.lastWeek - firstWeek) * rowHeight) / 7)
      );

export const settledMonthAnchor = (
  position: typeof MonthPosition.Type,
  rowHeight: number
): number => {
  const visibleRow =
    rowHeight > 0
      ? Math.floor(position.scrollTop / rowHeight)
      : monthMetrics.weekCount;

  const midpoint = initialNavigation(
    position.firstWeek + visibleRow * 7 + (monthMetrics.weekCount * 7) / 2
  ).anchor;

  return midpoint - partsFromDay(midpoint).day + 1;
};

export const monthWindowRange = (firstWeek: number) => ({
  end: firstWeek + monthWindowWeeks * 7,
  start: firstWeek,
});

export const initialMonthPosition = (
  visibleWeek: number,
  rowHeight: number
): typeof MonthPosition.Type => ({
  firstWeek: visibleWeek - monthMetrics.weekCount * 7,
  scrollTop: monthMetrics.weekCount * Math.max(0, rowHeight),
});

export const rebaseMonth = (
  position: typeof MonthPosition.Type,
  rowHeight: number,
  focusedDay?: number
): typeof MonthRebase.Type => {
  const inset = monthMetrics.weekCount / 2;

  const visibleRow =
    rowHeight > 0 ? position.scrollTop / rowHeight : monthMetrics.weekCount;

  if (visibleRow >= inset && visibleRow <= monthMetrics.weekCount + inset) {
    return MonthRebase.cases.Unchanged.make({ position });
  }

  const rows = Math.floor(visibleRow) - monthMetrics.weekCount;
  const firstWeek = position.firstWeek + rows * 7;
  const range = monthWindowRange(firstWeek);

  if (
    focusedDay !== undefined &&
    (focusedDay < range.start || focusedDay >= range.end)
  ) {
    return MonthRebase.cases.Held.make({ position });
  }

  return MonthRebase.cases.Rebased.make({
    position: { firstWeek, scrollTop: position.scrollTop - rows * rowHeight },
    rows,
  });
};
