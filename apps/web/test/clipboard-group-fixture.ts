import { CalendarEvent } from "@calendar/calendar/contracts";
import { DateTime, Option } from "effect";

import type { AppModel } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { ClipboardAnchor } from "../src/client/clipboard/model.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { fixtureModel } from "./fixture.js";

export const groupClipboardFixture = (month = false) => {
  const base = fixtureModel();
  const [first] = visibleEvents(base);

  if (first === undefined) {
    throw new Error("Group fixture needs a saved event");
  }

  const events = ["Alpha", "Beta", "Gamma"].map((title, index) =>
    CalendarEvent.make({
      ...first.source,
      attendees:
        index < 2
          ? [
              {
                email: `${title.toLowerCase()}@example.test`,
                optional: index === 1,
                responseStatus: "accepted",
              },
            ]
          : [],
      conferenceUrl: undefined,
      end: {
        dateTime: `2026-10-19T${String(9 + index * 2).padStart(2, "0")}:45:00-07:00`,
      },
      eventId: `clipboard-group-${index}`,
      guestsCanInviteOthers: false,
      guestsCanModify: false,
      guestsCanSeeOtherGuests: false,
      iCalUID: `clipboard-group-${index}@example.test`,
      reminders: {
        overrides: [{ method: "popup", minutes: 10 }],
        useDefault: false,
      },
      start: {
        dateTime: `2026-10-19T${String(9 + index * 2).padStart(2, "0")}:00:00-07:00`,
      },
      title,
    })
  );

  const model: AppModel = {
    ...base,
    calendar: {
      ...base.calendar,
      navigation: {
        ...base.calendar.navigation,
        mode: month ? ("month" as const) : ("week" as const),
      },
      reads: [
        {
          accountId: first.source.accountId,
          events: RemoteEvents.Success({ data: { events, versions: [] } }),
        },
      ],
      selected: [],
    },
  };

  const keys = visibleEvents(model)
    .map((item) => item.key)
    .toReversed();

  return {
    anchor: ClipboardAnchor.cases.Timed.make({
      date: "2026-10-21",
      instant: DateTime.toEpochMillis(
        DateTime.makeUnsafe("2026-10-21T10:00:00-07:00")
      ),
    }),
    events,
    keys,
    model: { ...model, calendar: { ...model.calendar, selected: keys } },
    personId: Option.getOrThrow(model.person),
  };
};

export const groupNativeEvent = (text = "") => {
  const data = new Map([
    ["text/plain", text],
    ["text/html", "old unowned rich clipboard"],
  ]);

  let prevented = false;

  return {
    data,
    event: {
      clipboardData: {
        clearData: () => {
          data.clear();
        },
        getData: (type: string) => data.get(type) ?? "",
        setData: (type: string, value: string) => {
          data.set(type, value);
        },
      },
      get defaultPrevented() {
        return prevented;
      },
      isTrusted: true,
      preventDefault: () => {
        prevented = true;
      },
      target: document.body,
    },
  };
};
