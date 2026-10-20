import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Schema } from "effect";

import {
  dayFromIso,
  initialNavigation,
  isoFromDay,
  keyAction,
  midnightInZone,
  navigate,
  periodStart,
  visibleDays,
} from "../src/layout/navigation.js";

it.effect("Sunday weeks keep calendar dates across spring and fall DST", () =>
  Effect.sync(() => {
    for (const date of ["2026-03-08", "2026-11-01"]) {
      const today = dayFromIso(date);
      const nav = initialNavigation(today);
      expect(periodStart(nav)).toBe(today);
      expect(visibleDays(nav).map(isoFromDay)).toEqual(
        Array.from({ length: 7 }, (_, index) => isoFromDay(today + index))
      );

      const start = DateTime.toEpochMillis(
        DateTime.makeUnsafe(midnightInZone(today, "America/Los_Angeles"))
      );

      const end = DateTime.toEpochMillis(
        DateTime.makeUnsafe(midnightInZone(today + 7, "America/Los_Angeles"))
      );

      expect((end - start) / 3_600_000).toBe(date.includes("03") ? 167 : 169);
      expect(navigate(nav, { direction: 1, type: "page" }, today).anchor).toBe(
        today + 7
      );
    }
  })
);

it.effect(
  "weekends adjust seven and five day ranges but keep other displayed-day counts",
  () =>
    Effect.sync(() => {
      const today = dayFromIso("2026-10-23");
      const nav = { ...initialNavigation(today), hideWeekends: true };
      expect(visibleDays(nav).map(isoFromDay)).toEqual([
        "2026-10-19",
        "2026-10-20",
        "2026-10-21",
        "2026-10-22",
        "2026-10-23",
      ]);
      const custom = { ...nav, days: 3, mode: "days" as const };
      expect(visibleDays(custom).map(isoFromDay)).toEqual([
        "2026-10-23",
        "2026-10-26",
        "2026-10-27",
      ]);
      expect(
        navigate(
          navigate(custom, { direction: 1, type: "page" }, today),
          { direction: -1, type: "page" },
          today
        )
      ).toEqual(custom);
      expect(navigate(nav, { mode: "day", type: "view" }, today).anchor).toBe(
        today
      );
      const seven = { ...custom, days: 7, hideWeekends: false };
      const five = navigate(seven, { type: "weekends" }, today);

      expect(visibleDays(five)).toHaveLength(5);
      expect(navigate(five, { type: "weekends" }, today)).toEqual(seven);
    })
);

it.effect.prop(
  "generated navigation histories agree with a calendar-day reference model",
  {
    moves: Schema.Array(Schema.Boolean),
    weekends: Schema.Boolean,
  },
  ({ moves, weekends }) =>
    Effect.sync(() => {
      const today = dayFromIso("2026-10-19");
      let nav = { ...initialNavigation(today), hideWeekends: weekends };
      let expected = today;

      for (const forward of moves.slice(0, 80)) {
        const direction = forward ? 1 : -1;
        nav = navigate(nav, { direction, type: "page" }, today);
        expected += direction * 7;
        expect(nav.anchor).toBe(expected);
        expect(visibleDays(nav)).toHaveLength(weekends ? 5 : 7);
        expect(navigate(nav, { type: "today" }, today).anchor).toBe(today);
      }
    })
);

it.effect("view keys, month bounds, and day limits are explicit", () =>
  Effect.sync(() => {
    expect(keyAction("0")).toEqual({ mode: "week", type: "view" });
    expect(keyAction("9")).toEqual({ days: 9, mode: "days", type: "view" });
    expect(keyAction("T")).toEqual({ type: "today" });
    expect(keyAction("c")).toBeUndefined();
    const today = dayFromIso("2026-10-19");

    const month = navigate(
      initialNavigation(today),
      { mode: "month", type: "view" },
      today
    );

    expect(visibleDays(month)).toHaveLength(42);
    expect(
      isoFromDay(navigate(month, { direction: 1, type: "page" }, today).anchor)
    ).toBe("2026-11-01");

    const end = {
      ...initialNavigation(dayFromIso("2040-12-31")),
      mode: "day" as const,
    };

    expect(navigate(end, { direction: 1, type: "page" }, today).anchor).toBe(
      end.anchor
    );
  })
);
