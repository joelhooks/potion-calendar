import { Option } from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { TimeZoneAction } from "../src/client/time-zones/model.js";
import { displayZone } from "../src/layout/time-zones.js";
import { fixtureSelection } from "./fixture.js";

export const timeZonesFixture = (
  travel = false,
  dark = false,
  viewportWidth = 920
): AppModel => {
  const base = fixtureSelection();
  let model = { ...base, calendar: { ...base.calendar, viewportWidth } };

  for (const id of ["America/New_York", "Europe/London"]) {
    ({ model } = update(
      model,
      Message.TimeZoneAction({
        action: TimeZoneAction.cases.Add.make({ zone: displayZone(id) }),
      })
    ));
  }

  if (travel) {
    ({ model } = update(
      model,
      Message.TimeZoneAction({
        action: TimeZoneAction.cases.Travel.make({
          zone: displayZone("Asia/Tokyo"),
        }),
      })
    ));

    for (const read of base.calendar.reads) {
      const data = Option.getOrUndefined(AsyncData.getData(read.events));

      if (data !== undefined) {
        ({ model } = update(
          model,
          Message.ReceivedEvents({
            accountId: read.accountId,
            request: model.calendar.rangeRequest,
            result: data,
          })
        ));
      }
    }
  }

  return {
    ...model,
    settings: { ...model.settings, theme: dark ? "dark" : "light" },
  };
};

export const timeZonesOverviewFixture = (viewportWidth: number): AppModel => {
  const base = timeZonesFixture(true, true, viewportWidth);

  return {
    ...base,
    calendar: { ...base.calendar, selected: [] },
    upcoming: {
      ...base.upcoming,
      data: RemoteEvents.Success({ data: { events: [], versions: [] } }),
    },
  };
};
