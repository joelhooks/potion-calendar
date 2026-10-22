import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Schema } from "effect";

import { exportIcsCalendar, IcsExportOutcome } from "../src/ical-export.js";
import { CalendarEvent } from "../src/model.js";
import type { CalendarEventValue } from "../src/model.js";

const stamp = DateTime.makeUnsafe("2026-10-22T12:00:00Z");

const event = (changes: Partial<CalendarEventValue> = {}): CalendarEventValue =>
  CalendarEvent.make({
    accountId: "owner",
    calendarId: "work",
    end: {
      dateTime: "2026-10-22T11:00:00-07:00",
      timeZone: "America/Los_Angeles",
    },
    eventId: "planning",
    start: {
      dateTime: "2026-10-22T10:00:00-07:00",
      timeZone: "America/Los_Angeles",
    },
    status: "confirmed",
    title: "Planning",
    ...changes,
  });

const content = (events: readonly CalendarEventValue[]): string => {
  const outcome = exportIcsCalendar(events, stamp);
  expect(IcsExportOutcome.guards.Ready(outcome)).toBe(true);

  return IcsExportOutcome.guards.Ready(outcome) ? outcome.content : "";
};

const field = (body: string, name: string): string => {
  const line = body
    .replaceAll(/\r\n[ \t]/gu, "")
    .split("\r\n")
    .find((value) => value.startsWith(`${name}:`));

  expect(line).toBeDefined();

  return line?.slice(name.length + 1) ?? "";
};

const utcMillis = (basic: string): number => {
  expect(basic).toMatch(/^\d{8}T\d{6}Z$/u);

  return DateTime.toEpochMillis(
    DateTime.makeUnsafe(
      `${basic.slice(0, 4)}-${basic.slice(4, 6)}-${basic.slice(6, 8)}T${basic.slice(9, 11)}:${basic.slice(11, 13)}:${basic.slice(13, 15)}Z`
    )
  );
};

it.effect(
  "ICS exports the held text, safe provider URL, invitation addresses and participation status without adding a scheduling METHOD",
  () =>
    Effect.sync(() => {
      const body = content([
        event({
          attendees: [
            { email: "accepted@example.test", responseStatus: "accepted" },
            { email: "tentative@example.test", responseStatus: "tentative" },
            { email: "declined@example.test", responseStatus: "declined" },
            { email: "pending@example.test" },
          ],
          description: "Description\r\nsecond line",
          htmlLink: "https://calendar.example.test/event?id=one",
          iCalUID: "google-uid@example.test",
          location: "Room, west; wing",
          organizer: { email: "owner@example.test" },
          title: "Planning; notes, \\ path\nnext",
        }),
      ]);

      expect(field(body, "UID")).toBe("google-uid@example.test");
      expect(field(body, "DTSTAMP")).toBe("20261022T120000Z");
      expect(field(body, "SUMMARY")).toBe(
        "Planning\\; notes\\, \\\\ path\\nnext"
      );
      expect(field(body, "DESCRIPTION")).toBe("Description\\nsecond line");
      expect(field(body, "LOCATION")).toBe("Room\\, west\\; wing");
      expect(field(body, "URL")).toBe(
        "https://calendar.example.test/event?id=one"
      );
      expect(field(body, "ORGANIZER")).toBe("mailto:owner@example.test");
      expect(field(body, "ATTENDEE;PARTSTAT=ACCEPTED")).toBe(
        "mailto:accepted@example.test"
      );
      expect(field(body, "ATTENDEE;PARTSTAT=TENTATIVE")).toBe(
        "mailto:tentative@example.test"
      );
      expect(field(body, "ATTENDEE;PARTSTAT=DECLINED")).toBe(
        "mailto:declined@example.test"
      );
      expect(field(body, "ATTENDEE;PARTSTAT=NEEDS-ACTION")).toBe(
        "mailto:pending@example.test"
      );
      expect(body).not.toMatch(/(?:^|\r\n)METHOD:/u);
      expect(body.endsWith("END:VCALENDAR\r\n")).toBe(true);
    })
);

it.prop(
  "ICS omits unsafe provider links while retaining a stable domain-free fallback UID",
  {
    link: Schema.Literals([
      // oxlint-disable-next-line eslint/no-script-url -- The deliberately unsafe fixture must never become an exported URL.
      "javascript:alert(1)",
      "data:text/html,unsafe",
      "file:///private/event",
      "https://name:secret@example.test/event",
      "relative/event",
    ]),
    serial: Schema.Int,
  },
  ({ link, serial }) => {
    const source = event({ eventId: `event-${serial}`, htmlLink: link });
    const body = content([source]);

    expect(field(body, "UID")).toBe(`event-${serial}-calendar-export`);
    expect(body).not.toMatch(/(?:^|\r\n)URL:/u);
    expect(content([source])).toBe(body);
  }
);

it.effect(
  "ICS refuses missing, inverted, mixed-kind and fractional-second event ranges rather than changing their instants",
  () =>
    Effect.sync(() => {
      for (const source of [
        event({ end: undefined }),
        event({ end: { dateTime: "2026-10-22T09:00:00-07:00" } }),
        event({ start: { date: "2026-10-22" } }),
        event({ start: { dateTime: "2026-10-22T10:00:00.001-07:00" } }),
        event({ end: { date: "2026-03-04" }, start: { date: "2026-02-31" } }),
      ]) {
        expect(exportIcsCalendar([source], stamp)).toMatchObject({
          reason: "invalidTime",
        });
      }

      expect(exportIcsCalendar([], stamp)).toMatchObject({
        reason: "emptySelection",
      });
    })
);

const zones = Schema.Literals([
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/Berlin",
  "Asia/Kathmandu",
  "Australia/Lord_Howe",
  "Pacific/Auckland",
]);

it.prop(
  "ICS timed UTC output preserves the supplied instant independently of its IANA zone",
  {
    seconds: Schema.Int.check(
      Schema.isBetween({ maximum: 2_051_222_400, minimum: 1_577_836_800 })
    ),
    zone: zones,
  },
  ({ seconds, zone }) => {
    const start = DateTime.makeUnsafe(seconds * 1000);
    const end = DateTime.add(start, { hours: 1 });

    const body = content([
      event({
        end: {
          dateTime: DateTime.formatIsoOffset(
            DateTime.setZoneNamedUnsafe(end, zone)
          ),
          timeZone: zone,
        },
        start: {
          dateTime: DateTime.formatIsoOffset(
            DateTime.setZoneNamedUnsafe(start, zone)
          ),
          timeZone: zone,
        },
      }),
    ]);

    expect(utcMillis(field(body, "DTSTART"))).toBe(seconds * 1000);
    expect(utcMillis(field(body, "DTEND"))).toBe((seconds + 3600) * 1000);
    expect(body).not.toMatch(
      /(?:^|\r\n)(?:DTSTART|DTEND|RECURRENCE-ID);TZID=/u
    );
    expect(body).not.toContain("BEGIN:VTIMEZONE");
  }
);

it.prop(
  "ICS all-day DTEND retains the exclusive source date over generated day lengths and year boundaries",
  {
    day: Schema.Int.check(Schema.isBetween({ maximum: 7305, minimum: 0 })),
    days: Schema.Int.check(Schema.isBetween({ maximum: 366, minimum: 1 })),
  },
  ({ day, days }) => {
    const start = DateTime.add(DateTime.makeUnsafe("2020-01-01T00:00:00Z"), {
      days: day,
    });

    const end = DateTime.add(start, { days });
    const from = DateTime.formatIsoDateUtc(start);
    const until = DateTime.formatIsoDateUtc(end);

    const body = content([
      event({ end: { date: until }, start: { date: from } }),
    ]);

    expect(field(body, "DTSTART;VALUE=DATE")).toBe(from.replaceAll("-", ""));
    expect(field(body, "DTEND;VALUE=DATE")).toBe(until.replaceAll("-", ""));
    expect(body).not.toMatch(/(?:^|\r\n)DT(?:START|END):/u);
  }
);

it.effect(
  "ICS offset conversion stays exact on both sides of DST transitions",
  () =>
    Effect.sync(() => {
      const instants = [
        "2026-03-08T09:59:00Z",
        "2026-03-08T10:01:00Z",
        "2026-03-29T00:59:00Z",
        "2026-03-29T01:01:00Z",
        "2026-04-04T14:59:00Z",
        "2026-04-04T15:01:00Z",
        "2026-11-01T08:59:00Z",
        "2026-11-01T09:01:00Z",
      ];

      for (const instant of instants) {
        const start = DateTime.makeUnsafe(instant);
        const end = DateTime.add(start, { hours: 1 });

        for (const zone of [
          "America/Los_Angeles",
          "Europe/Berlin",
          "Australia/Lord_Howe",
        ]) {
          const body = content([
            event({
              end: {
                dateTime: DateTime.formatIsoOffset(
                  DateTime.setZoneNamedUnsafe(end, zone)
                ),
                timeZone: zone,
              },
              start: {
                dateTime: DateTime.formatIsoOffset(
                  DateTime.setZoneNamedUnsafe(start, zone)
                ),
                timeZone: zone,
              },
            }),
          ]);

          expect(utcMillis(field(body, "DTSTART"))).toBe(
            DateTime.toEpochMillis(start)
          );
          expect(utcMillis(field(body, "DTEND"))).toBe(
            DateTime.toEpochMillis(end)
          );
        }
      }
    })
);

it.prop(
  "an exported UTC-master weekly RRULE expands to the fixture provider's exact instance instants across DST",
  {
    count: Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 2 })),
  },
  ({ count }) => {
    const providerStarts = [
      "2026-03-01T17:00:00Z",
      "2026-03-08T17:00:00Z",
      "2026-03-15T17:00:00Z",
      "2026-03-22T17:00:00Z",
      "2026-03-29T17:00:00Z",
      "2026-04-05T17:00:00Z",
    ];

    const body = content([
      event({
        end: { dateTime: "2026-03-01T18:00:00Z", timeZone: "UTC" },
        recurrence: [`RRULE:FREQ=WEEKLY;COUNT=${count}`],
        start: { dateTime: "2026-03-01T17:00:00Z", timeZone: "UTC" },
      }),
    ]);

    expect(field(body, "RRULE")).toBe(`FREQ=WEEKLY;COUNT=${count}`);
    const first = utcMillis(field(body, "DTSTART"));

    const expanded = Array.from(
      { length: count },
      (_, index) => first + index * 7 * 86_400_000
    );

    expect(expanded).toEqual(
      providerStarts
        .slice(0, count)
        .map((value) => DateTime.toEpochMillis(DateTime.makeUnsafe(value)))
    );
  }
);

it.prop(
  "two selected occurrences retain one Google UID with distinct original RECURRENCE-ID values and no RRULE",
  {
    allDay: Schema.Boolean,
  },
  ({ allDay }) => {
    const first = event({
      end: allDay
        ? { date: "2026-10-24" }
        : { dateTime: "2026-10-23T11:00:00-07:00" },
      eventId: "instance-a",
      iCalUID: "series@example.test",
      originalStartTime: allDay
        ? { date: "2026-10-22" }
        : { dateTime: "2026-10-22T10:00:00-07:00" },
      recurrence: ["RRULE:FREQ=WEEKLY"],
      recurringEventId: "series",
      start: allDay
        ? { date: "2026-10-23" }
        : { dateTime: "2026-10-23T10:00:00-07:00" },
    });

    const second = event({
      ...first,
      end: allDay
        ? { date: "2026-10-30" }
        : { dateTime: "2026-10-29T11:00:00-07:00" },
      eventId: "instance-b",
      originalStartTime: allDay
        ? { date: "2026-10-29" }
        : { dateTime: "2026-10-29T10:00:00-07:00" },
      start: allDay
        ? { date: "2026-10-29" }
        : { dateTime: "2026-10-29T10:00:00-07:00" },
    });

    const body = content([first, second]);
    const lines = body.replaceAll(/\r\n[ \t]/gu, "").split("\r\n");

    expect(lines.filter((line) => line === "BEGIN:VCALENDAR")).toHaveLength(1);
    expect(lines.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(2);
    expect(
      lines.filter((line) => line === "UID:series@example.test")
    ).toHaveLength(2);
    expect(lines.filter((line) => line.startsWith("RECURRENCE-ID"))).toEqual(
      allDay
        ? [
            "RECURRENCE-ID;VALUE=DATE:20261022",
            "RECURRENCE-ID;VALUE=DATE:20261029",
          ]
        : ["RECURRENCE-ID:20261022T170000Z", "RECURRENCE-ID:20261029T170000Z"]
    );
    expect(lines.some((line) => line.startsWith("RRULE:"))).toBe(false);
  }
);

it.prop(
  "zoned masters are explicitly skipped without losing supported selected events",
  {
    skippedCount: Schema.Int.check(
      Schema.isBetween({ maximum: 8, minimum: 1 })
    ),
  },
  ({ skippedCount }) => {
    const masters = Array.from({ length: skippedCount }, (_, index) =>
      event({ eventId: `master-${index}`, recurrence: ["RRULE:FREQ=WEEKLY"] })
    );

    const mixed = exportIcsCalendar([event(), ...masters], stamp);
    expect(mixed).toMatchObject({
      eventCount: 1,
      filename: "events.ics",
    });
    expect(mixed.skipped).toHaveLength(skippedCount);
    const refused = exportIcsCalendar(masters, stamp);
    expect(refused).toMatchObject({
      reason: "zonedRecurringMaster",
    });
    expect(refused.skipped).toHaveLength(skippedCount);
  }
);
