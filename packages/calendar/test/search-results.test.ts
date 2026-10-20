import { expect, it } from "@effect/vitest";
import { DateTime, Option, Schema } from "effect";

import type { CalendarEventValue } from "../src/model.js";
import {
  matchesLocalSearch,
  orderSearchResults,
  searchEventResult,
} from "../src/search-results.js";
import { searchCalendar } from "./search-fixture.js";

const localEvent = (
  fields: Partial<CalendarEventValue> = {}
): CalendarEventValue => ({
  accountId: "account",
  calendarId: "calendar",
  end: { dateTime: "2026-03-15T18:00:00Z" },
  eventId: "event",
  start: { dateTime: "2026-03-15T17:00:00Z" },
  status: "confirmed",
  ...fields,
});

it.prop(
  "any whitespace-separated token can match any indexed local field, ignoring case",
  {
    field: Schema.Literals([
      "title",
      "description",
      "location",
      "organizerName",
      "organizerEmail",
      "attendeeName",
      "attendeeEmail",
    ]),
    number: Schema.Int.check(
      Schema.isBetween({ maximum: 100_000, minimum: 0 })
    ),
  },
  ({ field, number }) => {
    const value = `prefixNeedle${number}suffix`;

    const fields: Record<typeof field, Partial<CalendarEventValue>> = {
      attendeeEmail: { attendees: [{ email: value }] },
      attendeeName: {
        attendees: [{ displayName: value, email: "person@example.test" }],
      },
      description: { description: value },
      location: { location: value },
      organizerEmail: { organizer: { email: value } },
      organizerName: { organizer: { displayName: value } },
      title: { title: value },
    };

    const event = localEvent(fields[field]);
    expect(matchesLocalSearch(event, `  ABSENT\tNEEDLE${number}\nOTHER `)).toBe(
      true
    );
    expect(matchesLocalSearch(event, `absent other`)).toBe(false);
    expect(matchesLocalSearch(event, " \t\n")).toBe(false);
    expect(matchesLocalSearch(localEvent(), `needle${number}`)).toBe(false);
  }
);

it.prop(
  "global ID dedup keeps the first copy independently of account and calendar, then orders by time",
  {
    offsets: Schema.Array(
      Schema.Int.check(Schema.isBetween({ maximum: 10_000, minimum: -10_000 }))
    ).check(Schema.isMinLength(1), Schema.isMaxLength(30)),
  },
  ({ offsets }) => {
    const rows = offsets.map((offset, index) => ({
      calendar: {
        ...searchCalendar(`calendar-${index}`),
        accountId: `account-${index}`,
      },
      endMillis: offset * 60_000 + 3_600_000,
      event: localEvent({
        accountId: `account-${index}`,
        calendarId: `calendar-${index}`,
        eventId: `event-${index % 3}`,
      }),
      startMillis: offset * 60_000,
    }));

    const results = orderSearchResults(rows);
    expect(new Set(results.map((row) => row.event.eventId)).size).toBe(
      results.length
    );
    expect(results).toHaveLength(Math.min(offsets.length, 3));

    for (const [index, row] of results.entries()) {
      expect(row).toBe(
        rows.find((candidate) => candidate.event.eventId === row.event.eventId)
      );
      expect(row.startMillis).toBeLessThanOrEqual(
        results[index + 1]?.startMillis ?? Number.POSITIVE_INFINITY
      );
    }
  }
);

it("local result normalization rejects cancelled, mismatched, missing and unusable event data", () => {
  const calendar = searchCalendar();

  for (const event of [
    localEvent({ status: "cancelled" }),
    localEvent({ calendarId: "missing-calendar" }),
    localEvent({ accountId: "wrong-account" }),
    localEvent({ start: undefined }),
    localEvent({ end: undefined }),
    localEvent({ end: { dateTime: "2026-03-15T16:00:00Z" } }),
    localEvent({ start: { dateTime: "2026-99-99T17:00:00Z" } }),
  ]) {
    expect(
      Option.isNone(searchEventResult(calendar, event, "America/Los_Angeles"))
    ).toBe(true);
  }

  const result = searchEventResult(
    calendar,
    localEvent(),
    "America/Los_Angeles"
  );

  expect(Option.isSome(result)).toBe(true);

  if (Option.isSome(result)) {
    expect(result.value.startMillis).toBe(
      DateTime.toEpochMillis(DateTime.makeUnsafe("2026-03-15T17:00:00Z"))
    );
  }
});
