import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { Option } from "effect";

import { RemoteEvents, eventKey } from "../src/client/calendar-state.js";
import { fixtureEvents, fixtureSelection } from "./fixture.js";

export const creatorEvent = (): CalendarEventValue => ({
  ...Option.getOrThrow(Option.fromUndefinedOr(fixtureEvents[0])),
  attendees: [
    {
      displayName: "Alex Rivera",
      email: "Alex@example.test",
      organizer: true,
      responseStatus: "accepted",
    },
    {
      displayName: "Blair Chen",
      email: "blair@example.test",
      optional: true,
      responseStatus: "tentative",
      self: true,
    },
    {
      displayName: "Casey Quinn",
      email: "casey@example.test",
      responseStatus: "needsAction",
    },
  ],
  organizer: {
    displayName: "Alex Rivera",
    email: "Alex@example.test",
    self: false,
  },
  title: "Design planning",
});

export const creatorModel = (event: CalendarEventValue) => {
  const model = fixtureSelection();

  return {
    ...model,
    calendar: {
      ...model.calendar,
      reads: [
        {
          accountId: "work",
          events: RemoteEvents.Success({
            data: { events: [event], versions: [] },
          }),
        },
      ],
      selected: [eventKey(event)],
    },
  };
};

export const creatorFixture = (scene: "attendee" | "non-attendee") =>
  creatorModel({
    ...creatorEvent(),
    creator:
      scene === "attendee"
        ? {
            displayName: "Blair Chen",
            email: " BLAIR@EXAMPLE.TEST ",
            self: true,
          }
        : {
            displayName: "Drew Morgan",
            email: "drew@example.test",
            self: false,
          },
  });
