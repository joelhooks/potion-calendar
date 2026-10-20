import type {
  CalendarEventValue,
  EventTimeValue,
} from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { displayEvent, eventWhen } from "../src/layout/presentation.js";
import type { DetailWhen } from "../src/layout/presentation.js";
import { fixtureModel } from "./fixture.js";

const format = (
  start: EventTimeValue,
  end: EventTimeValue
): DetailWhen | undefined => {
  const [calendar] = fixtureModel().calendar.calendars;

  if (calendar === undefined) {
    return undefined;
  }

  const event = {
    accountId: "work",
    calendarId: "primary",
    end,
    eventId: "time-example",
    start,
    status: "confirmed",
    title: "Time example",
  } satisfies CalendarEventValue;

  const shown = displayEvent(
    event,
    calendar,
    "America/Los_Angeles",
    Option.none()
  );

  return shown === undefined
    ? undefined
    : eventWhen(shown, "America/Los_Angeles", 2026);
};

it.effect(
  "same-day timed details show the date once and use the grid clock style",
  () =>
    Effect.sync(() => {
      expect(
        format(
          { dateTime: "2026-10-19T09:00:00-07:00" },
          { dateTime: "2026-10-19T10:00:00-07:00" }
        )
      ).toEqual({
        date: "Monday, October 19, 2026",
        time: "9am – 10am · America/Los_Angeles",
      });
    })
);

it.effect(
  "multi-day timed details show both endpoints without a redundant current year",
  () =>
    Effect.sync(() => {
      expect(
        format(
          { dateTime: "2026-10-19T21:00:00-07:00" },
          { dateTime: "2026-10-21T01:00:00-07:00" }
        )
      ).toEqual({
        date: "Mon, Oct 19, 9pm – Wed, Oct 21, 1am · America/Los_Angeles",
      });
    })
);

it.effect("a timed event ending at midnight names the next date and 12am", () =>
  Effect.sync(() => {
    expect(
      format(
        { dateTime: "2026-10-19T21:00:00-07:00" },
        { dateTime: "2026-10-20T00:00:00-07:00" }
      )
    ).toEqual({
      date: "Mon, Oct 19, 9pm – Tue, Oct 20, 12am · America/Los_Angeles",
    });
  })
);

it.effect("single all-day details show only their calendar date", () =>
  Effect.sync(() => {
    expect(format({ date: "2026-10-19" }, { date: "2026-10-20" })).toEqual({
      date: "Oct 19",
    });
  })
);

it.effect("multi-day all-day details use the inclusive last day", () =>
  Effect.sync(() => {
    expect(format({ date: "2026-10-19" }, { date: "2026-10-24" })).toEqual({
      date: "Oct 19 – 23",
    });
  })
);

it.effect(
  "timed endpoints include years when the event crosses a year boundary",
  () =>
    Effect.sync(() => {
      expect(
        format(
          { dateTime: "2026-12-31T21:00:00-08:00" },
          { dateTime: "2027-01-01T01:00:00-08:00" }
        )
      ).toEqual({
        date: "Thu, Dec 31, 2026, 9pm – Fri, Jan 1, 2027, 1am · America/Los_Angeles",
      });
      expect(
        format(
          { dateTime: "2025-12-30T21:00:00-08:00" },
          { dateTime: "2025-12-31T01:00:00-08:00" }
        )
      ).toEqual({
        date: "Tue, Dec 30, 2025, 9pm – Wed, Dec 31, 2025, 1am · America/Los_Angeles",
      });
    })
);
