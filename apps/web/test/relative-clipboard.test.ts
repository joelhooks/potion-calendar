import { CalendarEvent } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Option, Schema } from "effect";

import { ClipboardAnchor } from "../src/client/clipboard/model.js";
import {
  planRelativeClipboard,
  RelativeClipboardPlan,
} from "../src/layout/relative-clipboard.js";
import {
  captureSelectionClipboard,
  SelectionClipboardCapture,
} from "../src/layout/selection-clipboard.js";
import { primarySelection } from "../src/layout/selection-set.js";
import { clipboardSource } from "./clipboard-fixture.js";

const minute = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(180)
);

const year = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(2025),
  Schema.isLessThanOrEqualTo(2040)
);

const stamp = (text: string) =>
  DateTime.toEpochMillis(DateTime.makeUnsafe(text));

const iso = (value: number) => DateTime.formatIso(DateTime.makeUnsafe(value));

const event = (id: string, start: number, minutes: number) =>
  CalendarEvent.make({
    ...clipboardSource,
    end: { dateTime: iso(start + minutes * 60_000) },
    eventId: id,
    start: { dateTime: iso(start) },
  });

const snapshot = (
  events: readonly (typeof CalendarEvent.Type)[],
  selection = events.map((item) => item.eventId)
) => {
  const captured = captureSelectionClipboard({
    candidates: events.map((item) => ({ event: item, key: item.eventId })),
    copyId: "owned-selection",
    personId: "person-A",
    selection,
    selfEmails: ["owner@example.test"],
  });

  if (!SelectionClipboardCapture.guards.Captured(captured)) {
    throw new Error("Fixture capture refused");
  }

  return captured.snapshot;
};

const dateFromBase = (days: number) =>
  DateTime.formatIsoDateUtc(
    DateTime.add(DateTime.makeUnsafe("2028-02-01"), { days })
  );

const localFields = (instant: number, zone: string) => {
  const fields = new Map(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      timeZone: zone,
      year: "numeric",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value])
  );

  return {
    date: `${fields.get("year")}-${fields.get("month")}-${fields.get("day")}`,
    time: `${fields.get("hour")}:${fields.get("minute")}`,
  };
};

const localClock = (instant: string, zone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: zone,
  }).format(stamp(instant));

it.effect.prop(
  "home-zone wall-clock offsets survive DST changes without converting the group's arrangement to elapsed milliseconds",
  {
    durationA: minute,
    durationB: minute,
    region: Schema.Literals(["north", "south", "europe"]),
    reversed: Schema.Boolean,
    year,
  },
  ({ year: y, durationA, durationB, reversed, region }) =>
    Effect.gen(function* relativeWallClock() {
      const windows = {
        europe: {
          expected: `${y}-05-31T09:00:00+02:00`,
          first: `${y}-03-01T09:00:00+01:00`,
          second: `${y}-03-31T09:00:00+02:00`,
          target: `${y}-05-01T09:00:00+02:00`,
          zone: "Europe/Berlin",
        },
        north: {
          expected: `${y}-04-21T09:00:00-04:00`,
          first: `${y}-03-01T09:00:00-05:00`,
          second: `${y}-03-21T09:00:00-04:00`,
          target: `${y}-04-01T09:00:00-04:00`,
          zone: "America/New_York",
        },
        south: {
          expected: `${y}-06-21T09:00:00+10:00`,
          first: `${y}-03-01T09:00:00+11:00`,
          second: `${y}-04-21T09:00:00+10:00`,
          target: `${y}-05-01T09:00:00+10:00`,
          zone: "Australia/Sydney",
        },
      };

      const w = windows[region];

      const events = [
        event("earliest", stamp(w.first), durationA),
        event("later", stamp(w.second), durationB),
      ];

      const selection = reversed
        ? ["later", "earliest"]
        : ["earliest", "later"];

      const copied = snapshot(events, selection);

      const result = yield* planRelativeClipboard({
        anchor: ClipboardAnchor.cases.Timed.make({
          date: w.target.slice(0, 10),
          instant: stamp(w.target),
        }),
        homeZone: w.zone,
        personId: "person-A",
        snapshot: copied,
      });

      expect(RelativeClipboardPlan.guards.Planned(result)).toBe(true);

      if (!RelativeClipboardPlan.guards.Planned(result)) {
        return;
      }

      expect(result.anchorKey).toBe("earliest");
      expect(result.issues).toEqual([]);
      expect(result.steps.map((step) => step.key)).toEqual(selection);
      expect(primarySelection(selection)).toEqual(
        Option.some(selection.at(-1))
      );
      const later = result.steps.find((step) => step.key === "later");
      expect(later?.placement).toMatchObject({
        startDate: w.expected.slice(0, 10),
        startTime: "09:00",
        timeZone: w.zone,
      });
      expect(localClock(w.expected, w.zone)).toBe("09:00");

      const expectedEnd = localFields(
        stamp(w.expected) + durationB * 60_000,
        w.zone
      );

      expect(later?.placement).toMatchObject({
        endDate: expectedEnd.date,
        endTime: expectedEnd.time,
      });

      const firstEnd = localFields(
        stamp(w.target) + durationA * 60_000,
        w.zone
      );

      expect(
        result.steps.find((step) => step.key === "earliest")?.placement
      ).toMatchObject({ endDate: firstEnd.date, endTime: firstEnd.time });
      const earliest = result.steps.find((step) => step.key === "earliest");
      expect(earliest?.placement).toMatchObject({
        startDate: w.target.slice(0, 10),
        startTime: "09:00",
      });
      expect(
        result.steps.every(
          (step) => step.item.recurring && step.item.nativeConference
        )
      ).toBe(true);
      expect(
        copied.members.map((member) => member.item.source.eventId)
      ).toEqual(selection);
    })
);

it.effect.prop(
  "all-day translation keeps one date delta, selection order and each exclusive span across leap days and month boundaries",
  {
    offset: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(80)
    ),
    span: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(14)
    ),
    targetDay: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(28)
    ),
  },
  ({ offset, span, targetDay }) =>
    Effect.gen(function* relativeDates() {
      const date = dateFromBase;

      const events = [
        CalendarEvent.make({
          ...clipboardSource,
          end: { date: date(3) },
          eventId: "first",
          start: { date: date(0) },
        }),
        CalendarEvent.make({
          ...clipboardSource,
          end: { date: date(offset + span) },
          eventId: "second",
          start: { date: date(offset) },
        }),
      ];

      const target = `2029-12-${String(targetDay).padStart(2, "0")}`;

      const plan = yield* planRelativeClipboard({
        anchor: ClipboardAnchor.cases.AllDay.make({ date: target }),
        homeZone: "America/New_York",
        personId: "person-A",
        snapshot: snapshot(events, ["second", "first"]),
      });

      if (!RelativeClipboardPlan.guards.Planned(plan)) {
        throw new Error("Date plan refused");
      }

      expect(plan.anchorKey).toBe("first");
      expect(plan.issues).toEqual([]);
      const [second, first] = plan.steps;
      expect(first?.placement.startDate).toBe(target);
      expect(second?.placement.startDate).toBe(
        DateTime.formatIsoDateUtc(
          DateTime.add(DateTime.makeUnsafe(target), { days: offset })
        )
      );
      expect(second?.placement.endDate).toBe(
        DateTime.formatIsoDateUtc(
          DateTime.add(DateTime.makeUnsafe(target), { days: offset + span - 1 })
        )
      );
    })
);

it.effect.each(["2026-03-08", "2026-11-01"])(
  "a member shifted into the New York gap or fold becomes a named issue rather than normalized: %s",
  (target) =>
    Effect.gen(function* unsafeMember() {
      const gap = target.includes("03-08");
      const source = stamp(`2026-02-01T${gap ? "02" : "01"}:30:00-05:00`);

      const events = [
        event("anchor", source - 60_000 * 90, 30),
        event("unsafe", source, 30),
      ];

      const chosen = stamp(
        `${target}T${gap ? "01" : "00"}:00:00${gap ? "-05:00" : "-04:00"}`
      );

      const result = yield* planRelativeClipboard({
        anchor: ClipboardAnchor.cases.Timed.make({
          date: target,
          instant: chosen,
        }),
        homeZone: "America/New_York",
        personId: "person-A",
        snapshot: snapshot(events),
      });

      if (!RelativeClipboardPlan.guards.Planned(result)) {
        throw new Error("Plan unexpectedly refused");
      }

      expect(result.steps.map((step) => step.key)).toEqual(["anchor"]);
      expect(result.issues).toMatchObject([
        { key: "unsafe", reason: "unsafeLocalTime", title: "Product review" },
      ]);
      expect(result.issues[0]?.message).toBe(
        gap
          ? "Product review would start at 2:30am on Mar 8, which doesn't exist when clocks spring forward. Paste it somewhere else."
          : "Product review would start at 1:30am on Nov 1, which happens twice when clocks fall back. Paste it somewhere else."
      );
    })
);

it.effect(
  "a uniquely placed start whose elapsed-duration end falls in a fold is a named issue",
  () =>
    Effect.gen(function* foldedEnd() {
      const copied = snapshot([
        event("folded-end", stamp("2026-02-01T00:00:00-05:00"), 90),
      ]);

      const result = yield* planRelativeClipboard({
        anchor: ClipboardAnchor.cases.Timed.make({
          date: "2026-11-01",
          instant: stamp("2026-11-01T00:00:00-04:00"),
        }),
        homeZone: "America/New_York",
        personId: "person-A",
        snapshot: copied,
      });

      if (!RelativeClipboardPlan.guards.Planned(result)) {
        throw new Error("Unexpected plan refusal");
      }

      expect(result.steps).toEqual([]);
      expect(result.issues.map((item) => item.reason)).toEqual([
        "unsafeLocalTime",
      ]);
      expect(result.issues[0]?.message).toBe(
        "Product review would end at 1:30am on Nov 1, which happens twice when clocks fall back. Paste it somewhere else."
      );
    })
);

it.effect(
  "timed placement reads the target's home-zone coordinates rather than its travel-view date label and refuses date-only or invalid-zone targets",
  () =>
    Effect.gen(function* targetCoordinates() {
      const input = {
        anchor: ClipboardAnchor.cases.Timed.make({
          date: "2099-01-01",
          instant: stamp("2026-06-01T00:30:00Z"),
        }),
        homeZone: "America/New_York",
        personId: "person-A",
        snapshot: snapshot([event("event", stamp("2026-01-01T09:00:00Z"), 30)]),
      };

      const plan = yield* planRelativeClipboard(input);

      if (!RelativeClipboardPlan.guards.Planned(plan)) {
        throw new Error("Unexpected target refusal");
      }

      expect(plan.steps[0]?.placement).toMatchObject({
        startDate: "2026-05-31",
        startTime: "20:30",
      });

      const dateOnly = yield* planRelativeClipboard({
        ...input,
        anchor: ClipboardAnchor.cases.AllDay.make({ date: "2026-06-01" }),
      });

      expect(
        RelativeClipboardPlan.guards.Refused(dateOnly) &&
          dateOnly.issues[0]?.reason
      ).toBe("missingTime");

      const invalid = yield* planRelativeClipboard({
        ...input,
        homeZone: "Not/AZone",
      });

      expect(
        RelativeClipboardPlan.guards.Refused(invalid) &&
          invalid.issues[0]?.reason
      ).toBe("invalidZone");
    })
);

it.effect(
  "equal starts anchor by selection order, mixed ranges refuse explicitly and foreign owners never receive a plan",
  () =>
    Effect.gen(function* boundaryPlans() {
      const timed = [
        event("a", stamp("2026-01-01T09:00:00Z"), 30),
        event("b", stamp("2026-01-01T09:00:00Z"), 60),
      ];

      const input = {
        anchor: ClipboardAnchor.cases.Timed.make({
          date: "2026-02-01",
          instant: stamp("2026-02-01T09:00:00Z"),
        }),
        homeZone: "UTC",
        personId: "person-A",
        snapshot: snapshot(timed, ["b", "a"]),
      };

      const tied = yield* planRelativeClipboard(input);
      expect(RelativeClipboardPlan.guards.Planned(tied) && tied.anchorKey).toBe(
        "b"
      );

      const foreign = yield* planRelativeClipboard({
        ...input,
        personId: "person-B",
      });

      expect(
        RelativeClipboardPlan.guards.Refused(foreign) &&
          foreign.issues[0]?.reason
      ).toBe("ownerMismatch");

      const mixed = snapshot([
        timed[0] ?? clipboardSource,
        CalendarEvent.make({
          ...clipboardSource,
          end: { date: "2026-01-02" },
          eventId: "date",
          start: { date: "2026-01-01" },
        }),
      ]);

      const refused = yield* planRelativeClipboard({
        ...input,
        snapshot: mixed,
      });

      expect(
        RelativeClipboardPlan.guards.Refused(refused) &&
          refused.issues[0]?.reason
      ).toBe("mixedRanges");
    })
);
