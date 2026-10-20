import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { shiftedTime } from "../src/recurrence.js";
import { seriesZoneTime } from "../src/series-zone-time.js";

it.effect.each([
  {
    desired: "2026-03-15T09:30:00Z",
    masterDate: "2026-03-08",
    selectedDate: "2026-03-15",
    transition: "gap",
  },
  {
    desired: "2026-11-08T09:30:00Z",
    masterDate: "2026-11-01",
    selectedDate: "2026-11-08",
    transition: "fold",
  },
])(
  "a zone change refuses an unrepresentable master-date $transition",
  (input) =>
    Effect.gen(function* unsafeMasterClock() {
      const failure = yield* seriesZoneTime(
        { dateTime: `${input.masterDate}T09:00:00Z`, timeZone: "UTC" },
        { dateTime: `${input.selectedDate}T09:00:00Z`, timeZone: "UTC" },
        { dateTime: input.desired, timeZone: "America/Los_Angeles" }
      ).pipe(Effect.flip);

      expect(failure._tag).toBe("Provider");
      expect(failure.operation).toBe("recurrence");
      expect(failure.message).toContain("cannot preserve");
    })
);

it.effect(
  "an exception's own zone defines its displayed date, without changing an untouched series zone",
  () =>
    Effect.gen(function* exceptionZone() {
      const master = {
        dateTime: "2026-03-01T17:00:00Z",
        timeZone: "America/Los_Angeles",
      };

      const selected = {
        dateTime: "2026-03-15T00:00:00Z",
        timeZone: "Asia/Tokyo",
      };

      const changed = yield* shiftedTime(master, selected, {
        dateTime: "2026-03-15T16:00:00Z",
        timeZone: "America/Los_Angeles",
      });

      expect(changed).toEqual({
        dateTime: "2026-03-01T17:00:00.000Z",
        timeZone: "America/Los_Angeles",
      });

      const clockOnly = yield* shiftedTime(master, selected, {
        dateTime: "2026-03-15T01:00:00Z",
        timeZone: "Asia/Tokyo",
      });

      expect(clockOnly).toEqual({
        dateTime: "2026-03-01T18:00:00.000Z",
        timeZone: "America/Los_Angeles",
      });
    })
);

it.effect(
  "a missing master zone cannot be guessed from an exception's zone",
  () =>
    Effect.gen(function* missingZone() {
      const failure = yield* seriesZoneTime(
        { dateTime: "2026-03-01T17:00:00Z" },
        { dateTime: "2026-03-15T00:00:00Z", timeZone: "Asia/Tokyo" },
        { dateTime: "2026-03-15T16:00:00Z", timeZone: "America/Los_Angeles" }
      ).pipe(Effect.flip);

      expect(failure._tag).toBe("Provider");
    })
);

it.effect(
  "a zone change applies a typed calendar-day displacement on the master's own date",
  () =>
    Effect.gen(function* shiftedDay() {
      const changed = yield* seriesZoneTime(
        { dateTime: "2026-03-01T09:00:00Z", timeZone: "UTC" },
        { dateTime: "2026-03-15T09:00:00Z", timeZone: "UTC" },
        { dateTime: "2026-03-16T16:00:00Z", timeZone: "America/Los_Angeles" }
      );

      expect(changed).toEqual({
        dateTime: "2026-03-02T17:00:00.000Z",
        timeZone: "America/Los_Angeles",
      });
    })
);
