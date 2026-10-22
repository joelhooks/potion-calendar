import { Option } from "effect";

import type { AppModel } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { fixtureEvents } from "./fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";

export const icsExportFixture = (multiple = false): AppModel => {
  const base = keyboardFixture();
  const first = Option.getOrThrow(Option.fromUndefinedOr(fixtureEvents[0]));
  const second = Option.getOrThrow(Option.fromUndefinedOr(fixtureEvents[1]));

  const events = [first, second].map((event, index) => ({
    ...event,
    iCalUID: `export-${index}@example.test`,
    title: index === 0 ? "Planning export" : "Project review",
  }));

  const model = {
    ...base,
    calendar: {
      ...base.calendar,
      reads: [
        {
          accountId: first.accountId,
          events: RemoteEvents.Success({ data: { events, versions: [] } }),
        },
      ],
      selected: [],
    },
    desktop: { ...base.desktop, availability: "unavailable" },
  } satisfies AppModel;

  return {
    ...model,
    calendar: {
      ...model.calendar,
      selected: visibleEvents(model)
        .slice(0, multiple ? 2 : 1)
        .map((item) => item.key),
    },
  };
};
