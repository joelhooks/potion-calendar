import { expect, it } from "@effect/vitest";
import { Effect, Option, Result, Schema } from "effect";

import {
  changeWeekdayVisibility,
  displayedTimeDays,
  HiddenWeekdays,
  LastVisibleWeekday,
  monthTodayTarget,
  pageTimePeriod,
  rememberTimePeriod,
  restoreTimePeriod,
  TimePeriod,
  TimeVisibility,
  Weekday,
  WeekdayVisibilityAction,
} from "../src/layout/navigation-refinements.js";
import {
  dayFromIso,
  initialNavigation,
  isoFromDay,
  visibleDays,
} from "../src/layout/navigation.js";

const bounded = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ maximum, minimum }));

const anchor = bounded(17_000, 24_000);

const periodSchema = Schema.Struct({
  anchor,
  days: bounded(1, 31),
  mode: Schema.Literals(["day", "week", "days"]),
});

const weekday = (day: number): number => (((day + 4) % 7) + 7) % 7;

it.effect.prop(
  "generated hide and show histories preserve at least one visible weekday and apply only the observed five/seven weekend adjustment",
  {
    actions: Schema.Array(WeekdayVisibilityAction),
    hidden: HiddenWeekdays,
    period: periodSchema,
  },
  ({ actions, hidden, period }) =>
    Effect.sync(() => {
      let state = TimeVisibility.make({ hidden, period });
      let expected = new Set(hidden);
      let { days } = period;

      for (const action of actions) {
        const candidate = new Set(expected);

        const oldWeekendCount =
          Number(expected.has(0)) + Number(expected.has(6));

        WeekdayVisibilityAction.match(action, {
          Hide: ({ weekday: selectedDay }) => {
            candidate.add(selectedDay);
          },
          Show: ({ weekday: selectedDay }) => {
            candidate.delete(selectedDay);
          },
          Weekends: ({ hidden: shouldHide }) => {
            for (const day of [0, 6]) {
              if (shouldHide) {
                candidate.add(day);
              } else {
                candidate.delete(day);
              }
            }
          },
        });
        const outcome = changeWeekdayVisibility(state, action);

        if (candidate.size === 7) {
          expect(Result.isFailure(outcome)).toBe(true);

          if (Result.isFailure(outcome)) {
            expect(outcome.failure).toBeInstanceOf(LastVisibleWeekday);
          }
        } else {
          const newWeekendCount =
            Number(candidate.has(0)) + Number(candidate.has(6));

          if (
            period.mode === "days" &&
            days === 7 &&
            oldWeekendCount < 2 &&
            newWeekendCount === 2
          ) {
            days = 5;
          } else if (
            period.mode === "days" &&
            days === 5 &&
            oldWeekendCount > 0 &&
            newWeekendCount === 0
          ) {
            days = 7;
          }

          state = Result.getOrThrow(outcome);
          expected = candidate;
        }

        expect(new Set(state.hidden)).toEqual(expected);
        expect(state.hidden.length).toBeLessThan(7);
        expect(state.period).toEqual({ ...period, days });
      }
    })
);

it.effect.prop(
  "arbitrary hidden weekdays consume no columns and leave no visible dates missing inside a projected time period",
  { hidden: HiddenWeekdays, period: periodSchema, startsOn: Weekday },
  ({ hidden, period, startsOn }) =>
    Effect.sync(() => {
      const result = displayedTimeDays(period, hidden, startsOn);
      const excluded = new Set(hidden);

      const start =
        period.mode === "week"
          ? period.anchor - ((weekday(period.anchor) - startsOn + 7) % 7)
          : period.anchor;

      const candidates = Array.from(
        { length: period.mode === "week" ? 7 : period.days * 7 },
        (_, index) => start + index
      ).filter((day) => !excluded.has(weekday(day)));

      const expected =
        period.mode === "week"
          ? candidates
          : candidates.slice(0, period.mode === "day" ? 1 : period.days);

      expect(result).toEqual(expected);
      expect(new Set(result).size).toBe(result.length);
      expect(result.every((day) => !excluded.has(weekday(day)))).toBe(true);
    })
);

it.effect.prop(
  "legacy weekends and existing view projections agree without changing the live navigation implementation",
  { period: periodSchema, startsOn: Weekday, weekends: Schema.Boolean },
  ({ period, startsOn, weekends }) =>
    Effect.sync(() => {
      const navigation = {
        ...initialNavigation(period.anchor),
        ...period,
        hideWeekends: weekends,
        weekStartsOn: startsOn,
      };

      expect(
        displayedTimeDays(
          period,
          HiddenWeekdays.make(weekends ? [0, 6] : []),
          startsOn
        )
      ).toEqual(visibleDays(navigation));
    })
);

it.effect.prop(
  "display-period paging skips arbitrary hidden weekdays and returns to a normalized period without redefining J/K",
  { hidden: HiddenWeekdays, period: periodSchema, startsOn: Weekday },
  ({ hidden, period, startsOn }) =>
    Effect.sync(() => {
      const [first] = displayedTimeDays(period, hidden, startsOn);

      if (first === undefined) {
        throw new Error("Generated period must contain a visible day");
      }

      const normalized = TimePeriod.make({
        ...period,
        anchor: period.mode === "week" ? period.anchor : first,
      });

      const forward = pageTimePeriod(normalized, hidden, 1, startsOn);
      const restored = pageTimePeriod(forward, hidden, -1, startsOn);
      expect(restored).toEqual(normalized);

      if (period.mode === "week") {
        expect(forward.anchor - normalized.anchor).toBe(7);
      } else {
        const visibleBetween = Array.from(
          { length: forward.anchor - normalized.anchor },
          (_, index) => normalized.anchor + index
        ).filter((day) => !hidden.includes(weekday(day)));

        expect(visibleBetween).toHaveLength(
          period.mode === "day" ? 1 : period.days
        );
      }
    })
);

it.effect.prop(
  "month visits do not overwrite the previous period and restoring it preserves current display preferences",
  {
    months: Schema.Array(anchor),
    period: periodSchema,
    startsOn: Weekday,
    weekends: Schema.Boolean,
  },
  ({ period, months, startsOn, weekends }) =>
    Effect.sync(() => {
      const before = {
        ...initialNavigation(period.anchor),
        ...period,
        hideWeekends: !weekends,
        weekStartsOn: (startsOn + 1) % 7,
      };

      let previous = rememberTimePeriod(before, Option.none());

      for (const monthAnchor of months) {
        previous = rememberTimePeriod(
          { ...before, anchor: monthAnchor, mode: "month" },
          previous
        );
      }

      expect(previous).toEqual(Option.some(TimePeriod.make(period)));

      const current = {
        ...before,
        anchor: dayFromIso("2026-12-01"),
        hideWeekends: weekends,
        mode: "month" as const,
        weekStartsOn: startsOn,
      };

      const restored = Option.getOrThrow(restoreTimePeriod(current, previous));
      expect(restored).toEqual({ ...current, ...period });
      expect(restoreTimePeriod(current, Option.none())).toEqual(Option.none());
      expect(restoreTimePeriod(before, previous)).toEqual(Option.none());
    })
);

it.effect.prop(
  "month Align today starts at today's week while Go to today starts at the month for every week start",
  { startsOn: Weekday, today: anchor },
  ({ today, startsOn }) =>
    Effect.sync(() => {
      const month = dayFromIso(`${isoFromDay(today).slice(0, 8)}01`);
      const normal = monthTodayTarget(today, startsOn, "GoToToday");
      const aligned = monthTodayTarget(today, startsOn, "AlignToday");
      expect(normal).toEqual({
        anchor: month,
        firstWeek: month - ((weekday(month) - startsOn + 7) % 7),
      });
      expect(aligned).toEqual({
        anchor: today,
        firstWeek: today - ((weekday(today) - startsOn + 7) % 7),
      });
      expect(aligned.firstWeek).toBeGreaterThanOrEqual(normal.firstWeek);
    })
);

it.effect.prop(
  "the weekend adjustment is specific to custom five/seven counts and leaves every other mode and count alone",
  { period: periodSchema },
  ({ period }) =>
    Effect.sync(() => {
      for (const days of [period.days, 5, 7]) {
        const original = TimeVisibility.make({
          hidden: [],
          period: { ...period, days },
        });

        const hidden = Result.getOrThrow(
          changeWeekdayVisibility(
            original,
            WeekdayVisibilityAction.cases.Weekends.make({ hidden: true })
          )
        );

        const expectedHidden = period.mode === "days" && days === 7 ? 5 : days;
        expect(hidden.period.days).toBe(expectedHidden);

        const shown = Result.getOrThrow(
          changeWeekdayVisibility(
            hidden,
            WeekdayVisibilityAction.cases.Weekends.make({ hidden: false })
          )
        );

        expect(shown.period.days).toBe(
          period.mode === "days" && expectedHidden === 5 ? 7 : expectedHidden
        );
      }
    })
);

it.effect.prop(
  "date bounds are retained for arbitrary hiding and period paging without fabricating dates outside the existing calendar",
  {
    day: bounded(dayFromIso("2015-01-01"), dayFromIso("2040-12-31")),
    days: bounded(1, 31),
    hidden: HiddenWeekdays,
    mode: Schema.Literals(["day", "week", "days"]),
    startsOn: Weekday,
  },
  ({ day, hidden, startsOn, days, mode }) =>
    Effect.sync(() => {
      const period = TimePeriod.make({ anchor: day, days, mode });
      const minimum = dayFromIso("2015-01-01");
      const maximum = dayFromIso("2040-12-31");
      const projected = displayedTimeDays(period, hidden, startsOn);
      expect(
        projected.every((value) => minimum <= value && value <= maximum)
      ).toBe(true);

      for (const direction of [-1, 1] as const) {
        const paged = pageTimePeriod(period, hidden, direction, startsOn);
        expect(paged.anchor).toBeGreaterThanOrEqual(minimum);
        expect(paged.anchor).toBeLessThanOrEqual(maximum);
      }
    })
);

it.effect(
  "the desk-default refusal is atomic for the final weekday and both weekend days",
  () =>
    Effect.sync(() => {
      const period = TimePeriod.make({
        anchor: dayFromIso("2026-10-21"),
        days: 3,
        mode: "days",
      });

      const single = TimeVisibility.make({
        hidden: [0, 1, 2, 3, 4, 5],
        period,
      });

      const refused = changeWeekdayVisibility(
        single,
        WeekdayVisibilityAction.cases.Hide.make({ weekday: 6 })
      );

      expect(Result.isFailure(refused)).toBe(true);
      expect(single.hidden).toEqual([0, 1, 2, 3, 4, 5]);
      const pair = TimeVisibility.make({ hidden: [1, 2, 3, 4, 5], period });
      expect(
        Result.isFailure(
          changeWeekdayVisibility(
            pair,
            WeekdayVisibilityAction.cases.Weekends.make({ hidden: true })
          )
        )
      ).toBe(true);
      expect(pair.hidden).toEqual([1, 2, 3, 4, 5]);
      expect(
        Result.isSuccess(
          changeWeekdayVisibility(
            single,
            WeekdayVisibilityAction.cases.Hide.make({ weekday: 0 })
          )
        )
      ).toBe(true);
      expect(
        Result.getOrThrow(
          changeWeekdayVisibility(
            single,
            WeekdayVisibilityAction.cases.Show.make({ weekday: 6 })
          )
        ).hidden
      ).toEqual(single.hidden);
    })
);
