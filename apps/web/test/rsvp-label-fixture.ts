import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { Option } from "effect";

import type { AppModel } from "../src/client/app.js";
import { RemoteEvents, eventKey } from "../src/client/calendar-state.js";
import { fixtureEvents } from "./fixture.js";
import { phoneShellFixture } from "./phone-shell-fixture.js";

export const responseExamples = [
  { label: "Yes", response: "accepted" },
  { label: "No", response: "declined" },
  { label: "Maybe", response: "tentative" },
  { label: "Not answered", response: "needsAction" },
  { label: "Not answered", response: undefined },
] as const;

export const responseLabelScenes = [
  { height: 900, theme: "light", width: 1440 },
  { height: 900, theme: "dark", width: 900 },
  { height: 844, theme: "light", width: 390 },
] as const;

export const responseLabelFixture = (
  width: number,
  height: number,
  theme: "light" | "dark",
  attendees: NonNullable<
    CalendarEventValue["attendees"]
  > = responseExamples.map((example, index) => {
    const attendee = {
      displayName: `Guest ${index + 1}`,
      email: index === 0 ? "owner@example.test" : `guest-${index}@example.test`,
      optional: index === 2,
      organizer: index === 1,
      self: index === 0,
    };

    return example.response === undefined
      ? attendee
      : { ...attendee, responseStatus: example.response };
  })
): AppModel => {
  const base = phoneShellFixture(width, height, "details", theme);
  const source = Option.getOrThrow(Option.fromUndefinedOr(fixtureEvents[0]));
  const event = { ...source, attendees };

  return {
    ...base,
    calendar: {
      ...base.calendar,
      reads: [
        {
          accountId: "work",
          events: RemoteEvents.Success({
            data: { events: [event], versions: [] },
          }),
        },
      ],
      selected: [eventKey(event)],
      viewportWidth: width <= 640 ? width : width - (width <= 1000 ? 445 : 520),
    },
  };
};
