import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import type { AppModel } from "../src/client/app.js";
import { Message, update } from "../src/client/app.js";
import {
  monthHostKey,
  monthInitialPosition,
  monthNavigation,
} from "../src/client/month/host.js";
import { SettingsChange } from "../src/client/settings/model.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import {
  dayFromIso,
  partsFromDay,
  visibleDays,
  weekStart,
} from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { fixtureModel } from "./fixture.js";

const input = (key: string) =>
  Message.PressedCalendarKey({
    alt: false,
    key,
    mod: false,
    now: 0,
    shift: false,
  });

const weekday = Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 0 }));

it.effect.prop(
  "root weekday histories preserve selection and compose weekend toggles, custom counts and week starts",
  {
    changes: Schema.Array(weekday),
    count: Schema.Int.check(Schema.isBetween({ maximum: 31, minimum: 1 })),
    startsOn: weekday,
  },
  ({ changes, count, startsOn }) =>
    Effect.sync(() => {
      const base = fixtureModel();

      let model: AppModel = {
        ...base,
        calendar: {
          ...base.calendar,
          navigation: {
            ...base.calendar.navigation,
            days: count,
            mode: "days" as const,
            weekStartsOn: startsOn,
          },
          selected: visibleEvents(base)
            .slice(0, 3)
            .map((event) => event.key),
        },
      };

      const { selected } = model.calendar;
      let hidden = new Set<number>();
      let expectedCount = count;

      for (const [index, value] of changes.slice(0, 50).entries()) {
        const proposed = new Set(hidden);
        const weekends = index % 4 === 0;
        const wasBoth = hidden.has(0) && hidden.has(6);
        const wasShown = !hidden.has(0) && !hidden.has(6);

        if (weekends) {
          for (const day of [0, 6]) {
            if (wasBoth) {
              proposed.delete(day);
            } else {
              proposed.add(day);
            }
          }
        } else if (proposed.has(value)) {
          proposed.delete(value);
        } else {
          proposed.add(value);
        }

        const result = update(
          model,
          Message.ChangedSettings({
            change: weekends
              ? SettingsChange.cases.Weekends.make({ shown: wasBoth })
              : SettingsChange.cases.Weekday.make({
                  shown: hidden.has(value),
                  value,
                }),
          })
        );

        if (proposed.size === 7) {
          expect(Option.getOrUndefined(result.model.error)).toBe(
            "Keep at least one weekday visible."
          );
        } else {
          if (
            expectedCount === 7 &&
            !wasBoth &&
            proposed.has(0) &&
            proposed.has(6)
          ) {
            expectedCount = 5;
          } else if (
            expectedCount === 5 &&
            !wasShown &&
            !proposed.has(0) &&
            !proposed.has(6)
          ) {
            expectedCount = 7;
          }

          hidden = proposed;
        }

        ({ model } = result);
        const expected: number[] = [];

        for (
          let day = model.calendar.navigation.anchor;
          expected.length < expectedCount;
          day += 1
        ) {
          if (!hidden.has(partsFromDay(day).weekDay)) {
            expected.push(day);
          }
        }

        expect(visibleDays(model.calendar.navigation)).toEqual(expected);
        expect(preferenceSnapshot(model).hiddenWeekdays).toEqual(
          [...hidden].toSorted((a, b) => a - b)
        );
        expect(model.calendar.selected).toEqual(selected);
        expect(model.calendar.navigation.days).toBe(expectedCount);
      }
    })
);

it.effect.prop(
  "a requested time view wins while returning from Month restores dates once, never a stale or custom mode",
  {
    offset: Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: -3 })),
    requested: Schema.Int.check(Schema.isBetween({ maximum: 9, minimum: 2 })),
  },
  ({ offset, requested }) =>
    Effect.sync(() => {
      const base = fixtureModel();
      const anchor = dayFromIso("2026-10-12");

      const previous = {
        ...base,
        calendar: {
          ...base.calendar,
          navigation: {
            ...base.calendar.navigation,
            anchor,
            days: 3,
            mode: "days" as const,
          },
        },
      };

      let month = update(
        previous,
        Message.ClickedView({ days: 7, mode: "month" })
      ).model;

      const first = monthInitialPosition(month).firstWeek + 42;
      expect(Option.getOrThrow(month.calendar.previousTimePeriod).anchor).toBe(
        anchor
      );

      for (let i = 0; i < Math.abs(offset); i += 1) {
        month = update(
          month,
          Message.ClickedPage({ direction: offset < 0 ? -1 : 1 })
        ).model;
      }

      const restored = update(
        month,
        Message.ClickedView({ days: requested, mode: "days" })
      ).model;

      expect(restored.calendar.navigation.mode).toBe("days");
      expect(restored.calendar.navigation.days).toBe(requested);
      expect(restored.calendar.navigation.anchor).toBe(
        offset === 0 ? anchor : weekStart(monthNavigation(month).anchor)
      );
      expect(Option.isNone(restored.calendar.previousTimePeriod)).toBe(true);

      if (offset === 0) {
        expect(first <= anchor && anchor < first + 42).toBe(true);
      }

      const week = update(
        month,
        Message.ClickedView({ days: 7, mode: "week" })
      ).model;

      expect(week.calendar.navigation.mode).toBe("week");
      expect(week.calendar.navigation.days).toBe(7);
    })
);

it.effect.prop(
  "Month aligns today's week independently of the month-start Today target for every week start",
  { startsOn: weekday },
  ({ startsOn }) =>
    Effect.sync(() => {
      const base = fixtureModel();
      const today = dayFromIso("2026-10-21");

      const month = {
        ...base,
        calendar: {
          ...base.calendar,
          navigation: {
            ...base.calendar.navigation,
            anchor: dayFromIso("2026-12-15"),
            mode: "month" as const,
            weekStartsOn: startsOn,
          },
        },
      };

      const aligned = update(
        month,
        Message.KeyboardAction({ id: "align-today" })
      );

      const normal = update(month, Message.ClickedToday());
      expect(aligned.model.calendar.navigation.mode).toBe("month");
      expect(monthInitialPosition(aligned.model).firstWeek + 42).toBe(
        weekStart(today, startsOn)
      );
      expect(monthInitialPosition(normal.model).firstWeek + 42).toBe(
        weekStart(dayFromIso("2026-10-01"), startsOn)
      );
      expect(
        aligned.commands?.some((command) => command.name === "ScrollToNow") ??
          false
      ).toBe(false);
    })
);

it.effect(
  "custom weekday hiding leaves the settled Month frame and its five/seven columns untouched",
  () =>
    Effect.sync(() => {
      const base = fixtureModel();

      const month = update(
        base,
        Message.ClickedView({ days: 7, mode: "month" })
      ).model;

      const hostKey = Option.getOrThrow(monthHostKey(month));

      const settled = {
        ...month,
        month: {
          ...month.month,
          settled: Option.some({
            anchor: dayFromIso("2026-11-01"),
            position: { firstWeek: dayFromIso("2026-09-27"), scrollTop: 700 },
            session: { hostKey, id: 1 },
          }),
        },
      };

      const changed = update(
        settled,
        Message.ChangedSettings({
          change: SettingsChange.cases.Weekday.make({ shown: false, value: 2 }),
        })
      );

      expect(monthHostKey(changed.model)).toEqual(monthHostKey(settled));
      expect(monthNavigation(changed.model).anchor).toBe(
        dayFromIso("2026-11-01")
      );
      expect(visibleDays(changed.model.calendar.navigation)).toEqual(
        visibleDays(settled.calendar.navigation)
      );
      expect(
        changed.commands?.some((command) => command.name === "ReadEvents") ??
          false
      ).toBe(false);

      const paged = update(
        changed.model,
        Message.KeyboardAction({ id: "next" })
      ).model;

      expect(paged.calendar.navigation.anchor).toBe(dayFromIso("2026-12-01"));
    })
);

it.effect(
  "J/K move weeks in custom time view while body arrows page by the displayed visible dates",
  () =>
    Effect.sync(() => {
      const base = fixtureModel();

      const original = {
        ...base,
        calendar: {
          ...base.calendar,
          navigation: {
            ...base.calendar.navigation,
            anchor: dayFromIso("2026-10-19"),
            days: 3,
            hiddenWeekdays: [2],
            mode: "days" as const,
          },
        },
      };

      expect(
        update(original, input("j")).model.calendar.navigation.anchor
      ).toBe(dayFromIso("2026-10-26"));
      expect(
        update(original, input("ArrowRight")).model.calendar.navigation.anchor
      ).toBe(dayFromIso("2026-10-23"));
      expect(
        update(original, input("ArrowUp")).model.calendar.navigation
      ).toEqual(original.calendar.navigation);
    })
);
