import { CalendarEvent } from "@calendar/calendar/contracts";
import { Match, Option } from "effect";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { RemoteEvents, eventKey } from "../src/client/calendar-state.js";
import { TimeBlockAction } from "../src/client/time-blocks/model.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { CalendarRoute, SettingsRoute } from "../src/layout/route.js";
import { TimeBlockPreferences } from "../src/layout/time-blocks.js";
import { editorOriginal } from "./editor-fixture.js";
import { fixtureModel } from "./fixture.js";

export type TimeBlockScene =
  | "day"
  | "week"
  | "14-day"
  | "settings-empty"
  | "settings-list"
  | "settings-edit"
  | "settings-error";

export const timeBlockDay = dayFromIso("2026-10-21");

export const timeBlockPreferences = (): typeof TimeBlockPreferences.Type =>
  TimeBlockPreferences.make({
    blocks: [
      {
        color: "#4986e8",
        hidden: false,
        id: 1,
        name: "Morning",
        ranges: [{ endMinute: 690, startMinute: 480 }],
      },
      {
        color: "#7d8d85",
        hidden: true,
        id: 2,
        name: "Quiet time",
        ranges: [{ endMinute: 720, startMinute: 660 }],
      },
      {
        color: "#b8a181",
        hidden: true,
        id: 3,
        name: "Break",
        ranges: [{ endMinute: 780, startMinute: 720 }],
      },
    ],
    enabled: true,
  });

export const timeBlockModel = (
  scene: TimeBlockScene,
  width = 1440,
  theme: "light" | "dark" = "light"
): AppModel => {
  const base = fixtureModel();
  const settings = scene.startsWith("settings-");

  const events = [
    {
      end: "11:00",
      id: "adjacent",
      start: "10:00",
      title: "Ends at hidden boundary",
    },
    {
      end: "13:30",
      id: "straddling",
      start: "10:30",
      title: "Straddles the hidden span",
    },
    {
      end: "14:15",
      id: "after",
      start: "13:30",
      title: "After the hidden span",
    },
  ].map((event) =>
    CalendarEvent.make({
      ...editorOriginal,
      end: { dateTime: `2026-10-21T${event.end}:00-07:00` },
      eventId: `time-block-${event.id}`,
      organizer: { self: true },
      start: { dateTime: `2026-10-21T${event.start}:00-07:00` },
      title: event.title,
    })
  );

  const selected = events.find(
    (event) => event.eventId === "time-block-straddling"
  );

  const gridView = Match.value(scene).pipe(
    Match.when(
      "day",
      () =>
        ({ days: 1, mode: "day" }) satisfies Pick<
          AppModel["calendar"]["navigation"],
          "days" | "mode"
        >
    ),
    Match.when(
      "14-day",
      () =>
        ({ days: 14, mode: "days" }) satisfies Pick<
          AppModel["calendar"]["navigation"],
          "days" | "mode"
        >
    ),
    Match.orElse(
      () =>
        ({ days: 7, mode: "week" }) satisfies Pick<
          AppModel["calendar"]["navigation"],
          "days" | "mode"
        >
    )
  );

  let model: AppModel = {
    ...base,
    calendar: {
      ...base.calendar,
      mergeDuplicates: false,
      navigation: {
        ...base.calendar.navigation,
        anchor: scene === "week" ? dayFromIso("2026-10-19") : timeBlockDay,
        days: gridView.days,
        hideWeekends: false,
        mode: gridView.mode,
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
      selected: settings || selected === undefined ? [] : [eventKey(selected)],
      viewport: 904,
      viewportWidth: width - (width <= 1000 ? 445 : 520),
    },
    route: settings
      ? SettingsRoute.make({ page: "general" })
      : CalendarRoute.make({}),
    settings: {
      ...base.settings,
      theme,
      timeBlocks:
        scene === "settings-empty"
          ? { blocks: [], enabled: false }
          : timeBlockPreferences(),
    },
  };

  const personId = Option.getOrThrow(model.person);

  if (scene === "settings-edit" || scene === "settings-error") {
    ({ model } = update(
      model,
      Message.ChangedTimeBlocks({
        action: TimeBlockAction.cases.Edit.make({ id: 2 }),
        personId,
      })
    ));
  }

  if (scene === "settings-error") {
    ({ model } = update(
      model,
      Message.ChangedTimeBlocks({
        action: TimeBlockAction.cases.Range.make({
          edge: "end",
          index: 0,
          value: "09:00",
        }),
        personId,
      })
    ));
    ({ model } = update(
      model,
      Message.ChangedTimeBlocks({
        action: TimeBlockAction.cases.Save.make({}),
        personId,
      })
    ));
  }

  return model;
};
