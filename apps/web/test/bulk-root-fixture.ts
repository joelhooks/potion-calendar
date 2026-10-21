import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { Option } from "effect";

import { BulkView } from "../src/client/bulk/model.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { selectionHostKey } from "../src/client/selection/host.js";
import { isoFromDay } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { fixtureModel } from "./fixture.js";

export const bulkRootFixture = (month = false, recurring = false) => {
  const base = fixtureModel();
  const [first] = visibleEvents(base);

  if (first === undefined) {
    throw new Error("The saved event fixture is missing.");
  }

  const calendar = { ...first.calendar, accessRole: "owner" as const };

  const reader = {
    ...calendar,
    accessRole: "reader" as const,
    calendarId: "read-only",
    title: "Read only",
  };

  const events: readonly CalendarEventValue[] = ["Alpha", "Beta", "Gamma"].map(
    (title, index) => ({
      ...first.source,
      attendees:
        index === 0
          ? [{ email: "guest@example.test", responseStatus: "accepted" }]
          : [],
      calendarId: index === 2 ? reader.calendarId : calendar.calendarId,
      conference: undefined,
      conferenceUrl: undefined,
      conferencingStatus: undefined,
      end:
        index === 2
          ? { date: isoFromDay(first.startDay + 2) }
          : {
              dateTime: `${isoFromDay(first.startDay)}T${index === 0 ? "10:00:57" : "12:30:41"}-07:00`,
            },
      eventId: `bulk-${index}`,
      iCalUID: `bulk-${index}@example.test`,
      originalStartTime: undefined,
      recurrence: [],
      recurringEventId: index === 0 && recurring ? "bulk-series" : undefined,
      start:
        index === 2
          ? { date: isoFromDay(first.startDay + 1) }
          : {
              dateTime: `${isoFromDay(first.startDay)}T${index === 0 ? "09:00:23" : "11:15:09"}-07:00`,
            },
      title,
    })
  );

  const model = {
    ...base,
    calendar: {
      ...base.calendar,
      calendars: [calendar, reader],
      hidden: [],
      mergeDuplicates: false,
      navigation: {
        ...base.calendar.navigation,
        mode: month ? ("month" as const) : ("week" as const),
      },
      reads: [
        {
          accountId: calendar.accountId,
          events: RemoteEvents.Success({ data: { events, versions: [] } }),
        },
      ],
      selected: [],
    },
    editing: { ...base.editing, bulk: BulkView.cases.Idle.make({}) },
  };

  const hostKey = Option.getOrThrow(selectionHostKey(model));

  return {
    events,
    hostKey,
    keys: visibleEvents(model).map((event) => event.key),
    master: {
      ...events[0],
      ...first.source,
      eventId: "bulk-series",
      recurrence: ["RRULE:FREQ=WEEKLY"],
      recurringEventId: undefined,
    },
    model,
    personId: Option.getOrThrow(model.person),
  };
};
