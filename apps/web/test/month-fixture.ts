import { DateTime, Option } from "effect";
import { AsyncData } from "foldkit";

import type { AppModel } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { monthFrame, monthHostKey } from "../src/client/month/host.js";
import {
  settledMonthAnchor,
  monthWindowRange,
} from "../src/layout/month-window.js";
import { monthGeometry } from "../src/layout/month.js";
import { dayFromIso, isoFromDay, weekStart } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { fixtureEvents, fixtureModel } from "./fixture.js";

export const monthFixture = (
  theme: "light" | "dark",
  showWeekNumbers = false
): AppModel => {
  const base = fixtureModel();
  const [source] = fixtureEvents;

  if (source === undefined) {
    throw new Error("Missing provider fixture event");
  }

  const extra = Array.from({ length: 12 }, (_, index) => ({
    ...source,
    eventId: `month-overflow-${index}`,
    iCalUID: `month-overflow-${index}@fixture.invalid`,
    title: `Month item ${index + 1}`,
  }));

  const meeting = {
    ...source,
    end: {
      dateTime: DateTime.formatIso(
        DateTime.makeUnsafe(base.calendar.now + 90 * 60_000)
      ),
    },
    eventId: "month-next-meeting",
    iCalUID: "month-next-meeting@fixture.invalid",
    start: {
      dateTime: DateTime.formatIso(
        DateTime.makeUnsafe(base.calendar.now + 30 * 60_000)
      ),
    },
    title: "Month planning",
  };

  const events = [...fixtureEvents, ...extra, meeting];

  return {
    ...base,
    calendar: {
      ...base.calendar,
      navigation: { ...base.calendar.navigation, mode: "month" },
      reads: base.calendar.reads.map((read) => ({
        ...read,
        events: RemoteEvents.Success({
          data: {
            events: events.filter(
              (event) => event.accountId === read.accountId
            ),
            versions: [],
          },
        }),
      })),
      viewport: 844,
    },
    settings: { ...base.settings, showWeekNumbers, theme },
    upcoming: {
      ...base.upcoming,
      accepted: Option.some({ origin: "snapshot", request: 1 }),
      data: RemoteEvents.Success({ data: { events: [meeting], versions: [] } }),
      request: 1,
    },
  };
};

export const monthScrollingFixture = (
  theme: "light" | "dark",
  parked: boolean
): AppModel => {
  const base = monthFixture(theme, true);

  const selected = visibleEvents(base).find(
    (event) => event.title === "Product review"
  );

  if (selected === undefined) {
    throw new Error("Missing scrolling fixture source");
  }

  const firstWeek = monthFrame(base).firstWeek + (parked ? 10 : 4) * 7;
  const firstVisibleWeek = firstWeek + 42;

  const rolling = Array.from({ length: 6 }, (_unused, row) => ({
    ...selected.source,
    end: {
      dateTime: `${isoFromDay(firstVisibleWeek + row * 7 + 2)}T11:00:00-08:00`,
    },
    eventId: `rolling-${row}`,
    iCalUID: `rolling-${row}@fixture.invalid`,
    start: {
      dateTime: `${isoFromDay(firstVisibleWeek + row * 7 + 2)}T10:00:00-08:00`,
    },
    title: `Rolling meeting ${row + 1}`,
  }));

  const project = {
    ...selected.source,
    end: { date: isoFromDay(firstVisibleWeek + 12) },
    eventId: "rolling-project",
    iCalUID: "rolling-project@fixture.invalid",
    start: { date: isoFromDay(firstVisibleWeek + 1) },
    title: "Rolling project",
  };

  const model: AppModel = {
    ...base,
    calendar: {
      ...base.calendar,
      reads: base.calendar.reads.map((read) =>
        read.accountId === selected.source.accountId
          ? {
              ...read,
              events: RemoteEvents.Success({
                data: {
                  events: [
                    ...Option.getOrThrow(AsyncData.getData(read.events)).events,
                    ...rolling,
                    project,
                  ],
                  versions: [],
                },
              }),
            }
          : read
      ),
      selected: parked ? [selected.key] : [],
    },
  };

  const session = { hostKey: Option.getOrThrow(monthHostKey(model)), id: 1 };
  const { rowHeight } = monthGeometry(model.calendar.viewport, true);

  return {
    ...model,
    month: {
      ...model.month,
      frame: Option.some({
        frame: {
          firstWeek,
          pinnedWeek: parked
            ? Option.some(
                weekStart(
                  dayFromIso("2026-10-19"),
                  model.calendar.navigation.weekStartsOn
                )
              )
            : Option.none(),
          revision: 1,
        },
        session,
      }),
      range: Option.some(monthWindowRange(firstWeek)),
      rangeHost: Option.some(session.hostKey),
      settled: Option.some({
        anchor: settledMonthAnchor(
          { firstWeek, scrollTop: 6 * rowHeight },
          rowHeight
        ),
        session,
      }),
    },
  };
};
