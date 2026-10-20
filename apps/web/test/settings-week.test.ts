import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { dayFromIso } from "../src/layout/navigation.js";
import { weekNumber } from "../src/layout/settings-week.js";

it.effect(
  "ISO week numbers cross calendar-year boundaries without week zero",
  () =>
    Effect.sync(() => {
      for (const [date, expected] of [
        ["2021-01-01", 53],
        ["2021-01-04", 1],
        ["2026-01-01", 1],
        ["2026-10-19", 43],
        ["2026-12-31", 53],
      ] as const) {
        expect(weekNumber(dayFromIso(date))).toBe(expected);
      }
    })
);
