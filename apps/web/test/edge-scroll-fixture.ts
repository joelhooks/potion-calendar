import { CalendarEvent } from "@calendar/calendar/contracts";
import { Option } from "effect";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { eventKey, RemoteEvents } from "../src/client/calendar-state.js";
import { TimeZoneAction } from "../src/client/time-zones/model.js";
import { dayFromIso, isoFromDay } from "../src/layout/navigation.js";
import { displayZone } from "../src/layout/time-zones.js";
import { editorOriginal } from "./editor-fixture.js";
import { fixtureModel } from "./fixture.js";

export type EdgeScene =
  | "timed-move"
  | "all-day-resize"
  | "wide-no-overflow"
  | "narrow-preview";

export const edgeFirstDay = dayFromIso("2026-10-19");

export const edgeSceneModel = (
  scene: EdgeScene,
  width: number,
  theme: "light" | "dark",
  direction: "left" | "right" = "right"
): AppModel => {
  const base = fixtureModel();
  const wide = scene === "wide-no-overflow";
  const days = wide ? 1 : 14;
  const from = direction === "left" ? days - 3 : 0;
  const startDate = isoFromDay(edgeFirstDay + Math.max(0, from));
  const allDay = scene === "all-day-resize";

  const titles: Record<EdgeScene, string> = {
    "all-day-resize": "Edge scroll all-day planning",
    "narrow-preview":
      "Edge scroll preview title exceeding a narrow date column",
    "timed-move": "Edge scroll review",
    "wide-no-overflow": "Edge scroll review",
  };

  const event = CalendarEvent.make({
    ...editorOriginal,
    end: allDay
      ? { date: isoFromDay(edgeFirstDay + from + 3) }
      : { dateTime: `${startDate}T10:00:00-07:00` },
    eventId: `edge-${scene}`,
    organizer: { self: true },
    start: allDay
      ? { date: startDate }
      : { dateTime: `${startDate}T09:00:00-07:00` },
    title: titles[scene],
  });

  let model: AppModel = {
    ...base,
    calendar: {
      ...base.calendar,
      mergeDuplicates: false,
      navigation: {
        ...base.calendar.navigation,
        anchor: edgeFirstDay,
        days,
        hideWeekends: false,
        mode: "days",
      },
      reads: base.calendar.reads.map((read) => ({
        ...read,
        events: RemoteEvents.Success({
          data: {
            events: read.accountId === event.accountId ? [event] : [],
            versions: [],
          },
        }),
      })),
      selected: [eventKey(event)],
      viewport: 904,
      viewportWidth: width - (width <= 1100 ? 185 : 220) - 300 - (wide ? 8 : 0),
    },
    editing: { ...base.editing, gesture: Option.none() },
    settings: { ...base.settings, theme },
  };

  if (!wide) {
    for (const zone of ["America/New_York", "Europe/London", "Asia/Tokyo"]) {
      ({ model } = update(
        model,
        Message.TimeZoneAction({
          action: TimeZoneAction.cases.Add.make({ zone: displayZone(zone) }),
        })
      ));
    }
  }

  return model;
};
