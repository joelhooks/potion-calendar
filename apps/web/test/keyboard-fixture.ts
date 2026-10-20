import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { maximumDisplayedDays } from "../src/layout/navigation.js";
import { fixtureEvents, fixtureSelection } from "./fixture.js";

export const keyboardFixture = (editable = true): AppModel => {
  const model = fixtureSelection();

  return {
    ...model,
    calendar: {
      ...model.calendar,
      reads: ["work", "personal"].map((accountId) => ({
        accountId,
        events: RemoteEvents.Success({
          data: {
            events: fixtureEvents
              .filter((event) => event.accountId === accountId)
              .map((event) => ({ ...event, guestsCanModify: editable })),
            versions: [],
          },
        }),
      })),
    },
  };
};

export const keyboardDensityFixture = (gridWidth = 1220): AppModel => {
  const base = keyboardFixture();

  const { model } = update(
    base,
    Message.ClickedView({ days: maximumDisplayedDays, mode: "days" })
  );

  return {
    ...model,
    calendar: {
      ...model.calendar,
      reads: base.calendar.reads,
      viewportWidth: gridWidth,
    },
  };
};
