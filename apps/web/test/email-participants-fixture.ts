import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { Option } from "effect";

import type { AppModel } from "../src/client/app.js";
import { RemoteEvents, eventKey } from "../src/client/calendar-state.js";
import { fixtureEvents, fixtureSelection } from "./fixture.js";

export const emailScenes = [
  "button",
  "keyboard",
  "hidden",
  "solo",
  "omitted",
] as const;

export type EmailScene = (typeof emailScenes)[number];

export const emailFixture = (scene: EmailScene): AppModel => {
  const base = fixtureSelection();
  const source = Option.getOrThrow(Option.fromUndefinedOr(fixtureEvents[0]));

  const event: CalendarEventValue = {
    ...source,
    attendees:
      scene === "solo"
        ? []
        : [
            {
              displayName: "You",
              email: "owner@example.test",
              responseStatus: "accepted",
              self: true,
            },
            {
              displayName: "Alex",
              email: "Alex@example.test",
              organizer: true,
              responseStatus: "accepted",
            },
            {
              displayName: "Blair",
              email: "blair+design@example.test",
              responseStatus: "tentative",
            },
            {
              displayName: "Casey",
              email: "casey@example.test",
              optional: true,
              responseStatus: "needsAction",
            },
            {
              displayName: "Studio",
              email: "studio@resource.calendar.google.com",
              resource: true,
              responseStatus: "accepted",
            },
          ],
    attendeesOmitted: scene === "omitted",
    guestsCanSeeOtherGuests: scene !== "hidden",
    organizer: { email: "Alex@example.test", self: false },
    title: "Weekly sync",
  };

  const visibleEvent =
    scene === "hidden"
      ? {
          ...event,
          attendees: event.attendees?.filter(
            (person) => person.self === true || person.organizer === true
          ),
        }
      : event;

  return {
    ...base,
    calendar: {
      ...base.calendar,
      reads: [
        {
          accountId: "work",
          events: RemoteEvents.Success({
            data: { events: [visibleEvent], versions: [] },
          }),
        },
      ],
      selected: [eventKey(event)],
    },
  };
};

export const expectedParticipantHref =
  "mailto:Alex@example.test,blair%2Bdesign@example.test,casey@example.test?subject=Weekly%20sync";
