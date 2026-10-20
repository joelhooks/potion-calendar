import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Schema } from "effect";

import { dateChoiceLabel, parseGoToDate } from "../src/layout/go-to-date.js";
import {
  dayFromIso,
  dayInZone,
  isoFromDay,
  partsFromDay,
} from "../src/layout/navigation.js";

const reference = dayFromIso("2026-10-20");

it.effect.prop(
  "relative day and week phrases preserve calendar-day arithmetic across DST",
  {
    offset: Schema.Int.check(Schema.isBetween({ maximum: 300, minimum: 0 })),
    past: Schema.Boolean,
    weeks: Schema.Boolean,
  },
  ({ offset, weeks, past }) =>
    Effect.sync(() => {
      for (const date of ["2026-03-07", "2026-10-31", "2026-12-31"]) {
        const today = dayFromIso(date);
        const unit = weeks ? "weeks" : "days";
        const query = past ? `${offset} ${unit} ago` : `in ${offset} ${unit}`;
        expect(parseGoToDate(query, today)).toBe(
          today + offset * (weeks ? 7 : 1) * (past ? -1 : 1)
        );
      }
    })
);

it.effect.prop(
  "absolute ISO and US numeric dates round trip without inventing invalid dates",
  {
    day: Schema.Int.check(
      Schema.isBetween({
        maximum: dayFromIso("2040-12-31"),
        minimum: dayFromIso("2015-01-01"),
      })
    ),
  },
  ({ day }) =>
    Effect.sync(() => {
      const parts = partsFromDay(day);
      expect(parseGoToDate(isoFromDay(day), reference)).toBe(day);
      expect(
        parseGoToDate(`${parts.month}/${parts.day}/${parts.year}`, reference)
      ).toBe(day);
    })
);

it.effect.prop(
  "month-day phrases prefer the next occurrence and month arithmetic clamps to real days",
  {
    count: Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 0 })),
    day: Schema.Int.check(Schema.isBetween({ maximum: 28, minimum: 1 })),
    month: Schema.Int.check(Schema.isBetween({ maximum: 12, minimum: 1 })),
  },
  ({ month, day, count }) =>
    Effect.sync(() => {
      const thisYear = dayFromIso(
        `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      );

      const year = thisYear >= reference ? 2026 : 2027;
      expect(parseGoToDate(`${month}/${day}`, reference)).toBe(
        dayFromIso(
          `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
        )
      );

      const result = parseGoToDate(
        `in ${count} months`,
        dayFromIso("2026-01-31")
      );

      expect(result).toBeDefined();

      if (result !== undefined) {
        const parts = partsFromDay(result);
        expect((parts.year - 2026) * 12 + parts.month - 1).toBe(count);
        expect(parts.day).toBeGreaterThanOrEqual(28);
        expect(parts.day).toBeLessThanOrEqual(31);
      }
    })
);

it.effect(
  "empty, malformed and impossible dates suggest nothing, while examples use primary-zone today",
  () =>
    Effect.sync(() => {
      for (const input of [
        "",
        "   ",
        "nonsense",
        "2026-02-29",
        "2026-04-31",
        "13/1",
        "0/10",
        "feb 30",
        "2041-01-01",
        "-3 days",
        "nov 32",
      ]) {
        expect(parseGoToDate(input, reference), input).toBeUndefined();
      }

      const now = DateTime.toEpochMillis(
        DateTime.makeUnsafe("2026-10-20T01:00:00Z")
      );

      const today = dayInZone(now, "America/Los_Angeles");
      expect(isoFromDay(parseGoToDate("today", today) ?? 0)).toBe("2026-10-19");
      expect(parseGoToDate("in 10 weeks", reference)).toBe(reference + 70);
      expect(isoFromDay(parseGoToDate("nov 5", reference) ?? 0)).toBe(
        "2026-11-05"
      );
      expect(isoFromDay(parseGoToDate("feb 29", reference) ?? 0)).toBe(
        "2028-02-29"
      );
      expect(dateChoiceLabel(dayFromIso("2027-01-05"), reference)).toContain(
        "2027"
      );
      expect(dateChoiceLabel(reference, reference)).not.toContain("2026");
    })
);
