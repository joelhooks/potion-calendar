import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Result, Schema } from "effect";

import {
  ClipboardAnchor,
  ClipboardRange,
} from "../src/client/clipboard/model.js";
import { placeClipboardItem } from "../src/client/clipboard/placement.js";
import {
  planRelativeClipboard,
  RelativeClipboardPlan,
} from "../src/layout/relative-clipboard.js";
import { SelectionClipboardSnapshot } from "../src/layout/selection-clipboard.js";
import { clipboardItem } from "./clipboard-fixture.js";

const stamp = (text: string) =>
  DateTime.toEpochMillis(DateTime.makeUnsafe(text));

const year = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(2025),
  Schema.isLessThanOrEqualTo(2040)
);

const hour = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(5),
  Schema.isLessThanOrEqualTo(20)
);

const springSaturday = (y: number) => {
  const first = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
  }).format(stamp(`${y}-03-01T00:00:00Z`));

  return (
    7 +
    ((7 - ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(first)) % 7)
  );
};

it.effect.prop(
  "month date anchors move both home-zone endpoints by calendar days for single and group; a DST-spanning event keeps its wall clocks rather than its old elapsed duration",
  { hour, reversed: Schema.Boolean, year },
  ({ year: y, hour: h, reversed }) =>
    Effect.gen(function* calendarDayPlacement() {
      const clock = String(h).padStart(2, "0");
      const base = clipboardItem();

      const first = {
        ...base,
        range: ClipboardRange.cases.Timed.make({
          end: stamp(`${y}-03-02T${clock}:45:00-05:00`),
          start: stamp(`${y}-03-01T${clock}:15:00-05:00`),
        }),
      };

      const later = {
        ...base,
        range: ClipboardRange.cases.Timed.make({
          end: stamp(`${y}-03-03T${clock}:45:00-05:00`),
          start: stamp(`${y}-03-03T${clock}:15:00-05:00`),
        }),
        source: { ...base.source, eventId: "later" },
      };

      const saturday = springSaturday(y);
      const date = `${y}-03-${String(saturday).padStart(2, "0")}`;

      const anchor = ClipboardAnchor.cases.AllDay.make({
        date,
        origin: "month",
      });

      const original = { item: first, key: "earliest" };
      const other = { item: later, key: "later" };

      const snapshot = SelectionClipboardSnapshot.make({
        copyId: "month-copy",
        members: reversed ? [other, original] : [original, other],
        personId: "person-A",
        version: 1,
      });

      const group = yield* planRelativeClipboard({
        anchor,
        homeZone: "America/New_York",
        personId: "person-A",
        snapshot,
      });

      const planned = yield* Effect.succeed(group).pipe(
        Effect.filterOrElse(RelativeClipboardPlan.guards.Planned, () =>
          Effect.die("Month group refused")
        )
      );

      expect(planned.anchorKey).toBe("earliest");
      expect(planned.issues).toEqual([]);
      expect(planned.steps.map((step) => step.key)).toEqual(
        reversed ? ["later", "earliest"] : ["earliest", "later"]
      );

      const single = yield* placeClipboardItem(
        first,
        anchor,
        "America/New_York"
      );

      expect(single).toMatchObject({
        allDay: false,
        endDate: `${y}-03-${String(saturday + 1).padStart(2, "0")}`,
        endTime: `${clock}:45`,
        startDate: date,
        startTime: `${clock}:15`,
        timeZone: "America/New_York",
      });
      expect(
        planned.steps.find((step) => step.key === "earliest")?.placement
      ).toEqual(single);
      expect(
        planned.steps.find((step) => step.key === "later")?.placement
      ).toMatchObject({
        endTime: `${clock}:45`,
        startDate: `${y}-03-${String(saturday + 2).padStart(2, "0")}`,
        startTime: `${clock}:15`,
      });

      const duration =
        stamp(`${single.endDate}T${single.endTime}:00-04:00`) -
        stamp(`${single.startDate}T${single.startTime}:00-05:00`);

      expect(duration).toBe(first.range.end - first.range.start - 3_600_000);
    })
);

it.effect.each([
  {
    date: "2026-03-08",
    end: "03:15",
    phrase: "doesn't exist when clocks spring forward",
    time: "02:30",
  },
  {
    date: "2026-11-01",
    end: "02:15",
    phrase: "happens twice when clocks fall back",
    time: "01:30",
  },
])(
  "month start gaps/folds refuse single placement and name the affected group member: %s",
  ({ date, time, end, phrase }) =>
    Effect.gen(function* unsafeMonthClock() {
      const base = clipboardItem();

      const item = {
        ...base,
        range: ClipboardRange.cases.Timed.make({
          end: stamp(`2026-02-01T${end}:00-05:00`),
          start: stamp(`2026-02-01T${time}:00-05:00`),
        }),
      };

      const anchor = ClipboardAnchor.cases.AllDay.make({
        date,
        origin: "month",
      });

      const single = yield* placeClipboardItem(
        item,
        anchor,
        "America/New_York"
      ).pipe(Effect.result);

      expect(single._tag).toBe("Failure");

      const group = yield* planRelativeClipboard({
        anchor,
        homeZone: "America/New_York",
        personId: "person-A",
        snapshot: SelectionClipboardSnapshot.make({
          copyId: "month-gap",
          members: [{ item, key: "affected" }],
          personId: "person-A",
          version: 1,
        }),
      });

      const plan = yield* Effect.succeed(group).pipe(
        Effect.filterOrElse(RelativeClipboardPlan.guards.Planned, () =>
          Effect.die("Missing named month issue")
        )
      );

      expect(plan.steps).toEqual([]);
      expect(plan.issues[0]).toMatchObject({
        key: "affected",
        reason: "unsafeLocalTime",
        title: base.content.title,
      });
      expect(plan.issues[0]?.message).toContain(phrase);
    })
);

it.effect.each([
  {
    end: "2026-02-01T01:30:00-05:00",
    phrase: "would end at 1:30am on Nov 1, which happens twice",
    reason: "ambiguousTime",
    start: "2026-02-01T00:00:00-05:00",
    target: "2026-11-01",
  },
  {
    end: "2026-11-01T01:15:00-05:00",
    phrase: "would end before it starts",
    reason: "invalidRange",
    start: "2026-11-01T01:45:00-04:00",
    target: "2026-11-02",
  },
])(
  "month endpoint validation refuses repeated end clocks and any invalid wall-clock range instead of borrowing the elapsed duration: %s",
  ({ start, end, target, reason, phrase }) =>
    Effect.gen(function* invalidMonthEndpoints() {
      const base = clipboardItem();

      const item = {
        ...base,
        range: ClipboardRange.cases.Timed.make({
          end: stamp(end),
          start: stamp(start),
        }),
      };

      const anchor = ClipboardAnchor.cases.AllDay.make({
        date: target,
        origin: "month",
      });

      const result = yield* placeClipboardItem(
        item,
        anchor,
        "America/New_York"
      ).pipe(Effect.result);

      const failed = yield* Effect.succeed(result).pipe(
        Effect.filterOrElse(Result.isFailure, () =>
          Effect.die("Unsafe month endpoint was accepted")
        )
      );

      expect(failed.failure.reason).toBe(reason);
      expect(failed.failure.message).toContain(phrase);

      const group = yield* planRelativeClipboard({
        anchor,
        homeZone: "America/New_York",
        personId: "person-A",
        snapshot: SelectionClipboardSnapshot.make({
          copyId: "month-end",
          members: [{ item, key: "affected" }],
          personId: "person-A",
          version: 1,
        }),
      });

      const plan = yield* Effect.succeed(group).pipe(
        Effect.filterOrElse(RelativeClipboardPlan.guards.Planned, () =>
          Effect.die("Missing month endpoint issue")
        )
      );

      expect(plan.steps).toEqual([]);
      expect(plan.issues[0]?.message).toContain(phrase);
    })
);

it.effect(
  "month-only provenance does not turn a week all-day row into a timed paste target",
  () =>
    Effect.gen(function* dateAnchorBoundary() {
      const refused = yield* placeClipboardItem(
        clipboardItem(),
        ClipboardAnchor.cases.AllDay.make({ date: "2026-10-21" }),
        "America/Los_Angeles"
      ).pipe(Effect.result);

      expect(refused._tag).toBe("Failure");
    })
);
