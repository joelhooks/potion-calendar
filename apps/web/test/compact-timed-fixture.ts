import { CalendarEvent } from "@calendar/calendar/contracts";
import { DateTime, Match, Option } from "effect";

import type { AppModel } from "../src/client/app.js";
import { eventKey, RemoteEvents } from "../src/client/calendar-state.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { editorOriginal } from "./editor-fixture.js";
import { fixtureModel } from "./fixture.js";

export type CompactScene = "short-pair" | "boundary" | "overlap" | "resize";

export const compactDay = dayFromIso("2026-10-19");

export const compactEvent = (
  id: string,
  minutes: number,
  day = 0
): typeof CalendarEvent.Type => {
  const start = DateTime.add(DateTime.makeUnsafe("2026-10-19T16:00:00Z"), {
    days: day,
  });

  return CalendarEvent.make({
    ...editorOriginal,
    end: { dateTime: DateTime.formatIso(DateTime.add(start, { minutes })) },
    eventId: `compact-${id}`,
    organizer: { self: true },
    start: { dateTime: DateTime.formatIso(start) },
    title: Match.value(id).pipe(
      Match.when("fifteen", () => "Standup"),
      Match.when("below", () => "Standup"),
      Match.when("resize-source", () => "Standup"),
      Match.when("overlap-short", () => "1:1 with Sam"),
      Match.orElse(
        () => "Quarterly planning review with the platform and design teams"
      )
    ),
  });
};

export const compactSceneModel = (
  scene: CompactScene,
  width: number,
  theme: "light" | "dark"
): AppModel => {
  const base = fixtureModel();

  const events = Match.value(scene).pipe(
    Match.when("boundary", () => [
      compactEvent("below", 45),
      compactEvent("above", 47.5, 1),
    ]),
    Match.when("overlap", () => [
      compactEvent("overlap-short", 15),
      compactEvent("overlap-tall", 60),
    ]),
    Match.when("resize", () => [
      compactEvent("resize-source", 30),
      compactEvent("thirty", 30, 1),
    ]),
    Match.orElse(() => [
      compactEvent("fifteen", 15),
      compactEvent("thirty", 30, 1),
    ])
  );

  const [first] = events;

  return {
    ...base,
    calendar: {
      ...base.calendar,
      mergeDuplicates: false,
      navigation: {
        ...base.calendar.navigation,
        anchor: compactDay,
        days: 4,
        hideWeekends: false,
        mode: "days",
      },
      reads: base.calendar.reads.map((read) => ({
        ...read,
        events: RemoteEvents.Success({
          data: {
            events: read.accountId === editorOriginal.accountId ? events : [],
            versions: [],
          },
        }),
      })),
      selected: first === undefined ? [] : [eventKey(first)],
      viewport: 904,
      viewportWidth: width - (width <= 1100 ? 185 : 220) - 300,
    },
    editing: { ...base.editing, gesture: Option.none() },
    settings: {
      ...base.settings,
      theme,
      timeFormat: theme === "dark" ? "24" : "12",
    },
  };
};
