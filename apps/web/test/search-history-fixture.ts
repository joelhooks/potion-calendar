import { Option } from "effect";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { SearchPageNotice } from "../src/client/search/page-model.js";
import { searchQueryTask } from "../src/client/search/source.js";
import { phoneShellFixture } from "./phone-shell-fixture.js";
import { outsideSearchEvent, searchResponse } from "./search-fixture.js";
import { loadedSearch } from "./search-more-fixture.js";

export const searchHistoryScenes = [
  { height: 900, scene: "arrival", theme: "light", width: 1440 },
  { height: 900, scene: "horizon", theme: "dark", width: 900 },
  { height: 844, scene: "arrival", theme: "light", width: 390 },
] as const;

export const searchHistoryFixture = (
  scene: (typeof searchHistoryScenes)[number]
) => {
  const base = loadedSearch();

  const shell = phoneShellFixture(
    scene.width,
    scene.height,
    "closed",
    scene.theme
  );

  const events = Array.from({ length: 20 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");

    return {
      ...outsideSearchEvent,
      end: { dateTime: `2026-11-${day}T10:00:00-08:00` },
      eventId: `history-existing-${index}`,
      start: { dateTime: `2026-11-${day}T09:00:00-08:00` },
      title: `Existing planning result ${index + 1}`,
    };
  });

  const response = searchResponse(events);

  const before: AppModel = {
    ...base,
    calendar: {
      ...base.calendar,
      viewport: shell.calendar.viewport,
      viewportWidth: scene.width,
    },
    phoneShell: shell.phoneShell,
    search: {
      ...base.search,
      response: Option.some({
        ...response,
        pageInfo: [
          {
            accountId: "work",
            calendarId: "primary",
            forwardHasMore: false,
            olderCursor: {
              windowEnd:
                scene.scene === "horizon"
                  ? "2016-11-18T08:00:00Z"
                  : "2025-09-20T07:00:00Z",
            },
            olderHasMore: true,
          },
        ],
      }),
    },
    settings: { ...base.settings, theme: scene.theme },
  };

  const pending = update(before, Message.SearchOlder()).model;
  const task = Option.getOrThrow(searchQueryTask(pending));

  const continuation = Option.getOrThrow(
    Option.fromUndefinedOr(pending.search.reverseContinuation)
  );

  const olderEvents =
    scene.scene === "horizon"
      ? []
      : [1, 2, 3].map((day) => ({
          ...outsideSearchEvent,
          end: { dateTime: `2025-08-0${day}T10:00:00-07:00` },
          eventId: `history-arrived-${day}`,
          start: { dateTime: `2025-08-0${day}T09:00:00-07:00` },
          title: `Older planning result ${day}`,
        }));

  const notice = SearchPageNotice.cases.Ready.make({
    direction: "reverse",
    page: { continuation, task },
    response: {
      ...searchResponse(olderEvents),
      pageInfo: [
        {
          accountId: "work",
          calendarId: "primary",
          forwardHasMore: false,
          olderCursor:
            scene.scene === "horizon"
              ? undefined
              : { windowEnd: "2024-09-20T07:00:00Z" },
          olderHasMore: scene.scene !== "horizon",
        },
      ],
      window: response.window,
    },
  });

  const after = update(
    pending,
    Message.ApplySearchPage({ anchor: Option.none(), notice })
  ).model;

  return { after, before, notice, pending };
};
