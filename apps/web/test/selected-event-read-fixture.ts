import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { Option } from "effect";

import type { AppModel } from "../src/client/app.js";
import { RemoteEvents, eventKey } from "../src/client/calendar-state.js";
import { chooseVisibility } from "../src/client/settings/visibility.js";
import { fixtureEvents } from "./fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";

export const providerOriginalHref =
  "https://calendar.google.com/calendar/event?eid=fixture-original";

// oxlint-disable-next-line eslint/no-script-url -- A deliberately unsafe provider fixture must remain inert at both URL boundaries.
const unsafeProviderHref = "javascript:alert('not-a-provider')";

export const selectedReadScenarios = [
  "selected",
  "no-selection",
  "multiple",
  "no-url",
  "unsafe-url",
  "hidden-calendar",
  "read-only",
] as const;

export type SelectedReadScenario = (typeof selectedReadScenarios)[number];

export const selectedReadFixture = (
  scenario: SelectedReadScenario
): AppModel => {
  const base = keyboardFixture();
  const source = Option.getOrThrow(Option.fromUndefinedOr(fixtureEvents[0]));
  const another = Option.getOrThrow(Option.fromUndefinedOr(fixtureEvents[1]));

  let event: CalendarEventValue = { ...source };

  if (scenario !== "no-url") {
    event = {
      ...event,
      htmlLink:
        scenario === "unsafe-url" ? unsafeProviderHref : providerOriginalHref,
    };
  }

  const calendars = base.calendar.calendars.map((calendar) =>
    scenario === "read-only" &&
    calendar.accountId === event.accountId &&
    calendar.calendarId === event.calendarId
      ? { ...calendar, accessRole: "reader" as const }
      : calendar
  );

  const visibility = chooseVisibility(
    calendars,
    base.calendar.visibility,
    base.calendar.visibilityMigration,
    event,
    scenario !== "hidden-calendar"
  );

  let selected = [eventKey(event)];

  if (scenario === "no-selection") {
    selected = [];
  } else if (scenario === "multiple") {
    selected = [eventKey(event), eventKey(another)];
  }

  return {
    ...base,
    calendar: {
      ...base.calendar,
      ...visibility,
      calendars,
      reads: [
        {
          accountId: event.accountId,
          events: RemoteEvents.Success({
            data: { events: [event, another], versions: [] },
          }),
        },
      ],
      selected,
    },
  };
};
