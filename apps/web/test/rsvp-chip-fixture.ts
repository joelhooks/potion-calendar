import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { DateTime, Option } from "effect";

import type { AppModel } from "../src/client/app.js";
import { RemoteEvents, eventKey } from "../src/client/calendar-state.js";
import { dayInZone } from "../src/layout/navigation.js";
import { phoneShellFixture } from "./phone-shell-fixture.js";

export const rsvpScenes = [
  { height: 900, mode: "week", theme: "light", width: 1440 },
  { height: 900, mode: "week", theme: "dark", width: 900 },
  { height: 900, mode: "month", theme: "light", width: 900 },
  { height: 844, mode: "day", theme: "dark", width: 390 },
] as const;

export type RsvpScene = (typeof rsvpScenes)[number];

type SelfResponse = "accepted" | "declined" | "needsAction" | "tentative";

export const rsvpEvent = (
  id: string,
  hour: number,
  self: SelfResponse,
  colorId: string,
  others: readonly SelfResponse[] = ["accepted"],
  day = 19
): CalendarEventValue => ({
  accountId: "work",
  attachments: [],
  attendees: [
    { email: "owner@example.test", responseStatus: self, self: true },
    ...others.map((responseStatus, index) => ({
      email: `attendee${index}@example.test`,
      responseStatus,
    })),
  ],
  calendarId: "primary",
  colorId,
  end: {
    dateTime: `2026-10-${day}T${String(hour + 1).padStart(2, "0")}:00:00-07:00`,
  },
  eventId: id,
  start: {
    dateTime: `2026-10-${day}T${String(hour).padStart(2, "0")}:00:00-07:00`,
  },
  status: "confirmed",
  title: id.replaceAll("-", " "),
});

export const rsvpChipFixture = (scene: RsvpScene): AppModel => {
  const base = phoneShellFixture(
    scene.width,
    scene.height,
    "closed",
    scene.theme
  );

  const month = scene.mode === "month";
  const phone = scene.mode === "day";

  const events = [
    rsvpEvent("accepted", 9, "accepted", "9"),
    rsvpEvent("declined", 10, "declined", "4", ["accepted"], month ? 20 : 19),
    rsvpEvent(
      "unanswered",
      11,
      "needsAction",
      "5",
      ["accepted"],
      month ? 21 : 19
    ),
    rsvpEvent("tentative", 12, "tentative", "6", ["accepted"], month ? 22 : 19),
    rsvpEvent(
      "unconfirmed",
      13,
      "accepted",
      "10",
      ["declined"],
      month ? 23 : 19
    ),
    rsvpEvent("selected-normal", 14, "accepted", "3"),
    rsvpEvent(
      "selected-declined",
      phone ? 15 : 10,
      "declined",
      "4",
      ["accepted"],
      phone ? 19 : 20
    ),
    rsvpEvent(
      "selected-unanswered",
      phone ? 16 : 11,
      "needsAction",
      "5",
      ["accepted"],
      phone ? 19 : 20
    ),
    rsvpEvent(
      "selected-unconfirmed",
      phone ? 17 : 13,
      "accepted",
      "10",
      ["declined"],
      phone ? 19 : 20
    ),
    rsvpEvent(
      "others-tentative",
      12,
      "accepted",
      "2",
      ["tentative", "tentative"],
      21
    ),
  ];

  const now = DateTime.toEpochMillis(
    DateTime.makeUnsafe("2026-10-19T11:30:00-07:00")
  );

  const panel = scene.width <= 1000 ? 185 : 220;

  return {
    ...base,
    calendar: {
      ...base.calendar,
      navigation: {
        ...base.calendar.navigation,
        anchor: dayInZone(now, base.calendar.zone),
        mode: scene.mode,
      },
      now,
      previousTimePeriod: Option.none(),
      reads: ["work", "personal"].map((accountId) => ({
        accountId,
        events: RemoteEvents.Success({
          data: {
            events: events.filter((event) => event.accountId === accountId),
            versions: [],
          },
        }),
      })),
      selected: events.flatMap((event) =>
        event.eventId.startsWith("selected-") ? [eventKey(event)] : []
      ),
      viewport: scene.height - (scene.width <= 640 ? 145 : 73),
      viewportWidth: scene.width <= 640 ? scene.width : scene.width - panel,
    },
    settings: { ...base.settings, hideContextPanel: true },
    upcoming: {
      ...base.upcoming,
      data: RemoteEvents.Success({ data: { events: [], versions: [] } }),
    },
  };
};
