import { DateTime, Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel } from "../client/app.js";
import { Message } from "../client/message.js";
import type { AppMessage } from "../client/message.js";
import { reverseSearchTargets } from "../client/search/paging.js";
import { searchScope } from "../client/search/source.js";
import {
  resolvedAppLocale,
  deskDefaultFormattingCalendar,
} from "../layout/app-locale.js";
import {
  searchCalendarFailureNotices,
  searchProblemLines,
} from "../layout/search-results.js";
import type { SearchResponse } from "../search-contract.js";
import { calendarFailureNotice } from "./search-failures.js";

const reachedHorizon = (response: typeof SearchResponse.Type): boolean =>
  response.failures.length === 0 &&
  response.accountFailures.length === 0 &&
  response.pageInfo.length > 0 &&
  response.pageInfo.every(
    (page) => page.olderHasMore === false && page.olderCursor === undefined
  );

const searchHistoryState = (model: AppModel) => {
  const response = Option.getOrUndefined(model.search.response);

  const active =
    model.search.responseScope === searchScope(model) &&
    ["Ready", "LoadingMore", "MoreFailed"].includes(model.search.phase);

  if (response === undefined || !active) {
    return Option.none();
  }

  const ledger = Option.getOrElse(model.search.reverseFailures, () => ({
    accountFailures: [],
    failures: [],
  }));

  const ownResponse = { ...response, ...ledger };

  const failed = model.search.reversePhase === "MoreFailed";

  return Option.some({
    available: reverseSearchTargets(ownResponse).length > 0,
    busy: model.search.reversePhase === "LoadingMore",
    failed,
    failures: searchCalendarFailureNotices(ownResponse, model),
    historyLabel: DateTime.format(
      DateTime.makeZonedUnsafe(response.window.historyStart, {
        timeZone: model.calendar.zone,
      }),
      {
        calendar: deskDefaultFormattingCalendar,
        locale: resolvedAppLocale(model),
        month: "short",
        year: "numeric",
      }
    ),
    horizon:
      model.search.reversePhase === "Ready" && reachedHorizon(ownResponse),
    legacy: response.pageInfo.some(
      (page) => page.olderHasMore === true && page.olderCursor === undefined
    ),
    problems:
      failed && Option.isSome(model.search.reverseProblem)
        ? searchProblemLines(model.search.reverseProblem.value, model)
        : [],
  });
};

export const searchHistoryPages = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  const result = searchHistoryState(model);

  if (Option.isNone(result)) {
    return [];
  }

  const state = result.value;

  const controls = [
    ...state.failures.map((failure) =>
      calendarFailureNotice(model, { ...failure, reverse: true }, h)
    ),
    ...state.problems.map((line) =>
      h.p([h.DataAttribute("search-failure", "true")], [line])
    ),
    ...(state.available && !state.failed
      ? [
          h.keyed("button")(
            "load-older",
            [
              h.Type("button"),
              h.Disabled(state.busy),
              h.OnClick(Message.SearchOlder()),
            ],
            ["Load older results"]
          ),
        ]
      : []),
    ...(state.failed
      ? [
          h.keyed("button")(
            "retry-older",
            [h.Type("button"), h.OnClick(Message.SearchRetryOlder())],
            ["Retry loading older results"]
          ),
        ]
      : []),
    ...(state.busy ? [h.p([], ["Loading older results…"])] : []),
    ...(state.horizon
      ? [
          h.p(
            [h.DataAttribute("search-history-horizon", "true")],
            [`Searched back to ${state.historyLabel}`]
          ),
        ]
      : []),
    ...(state.legacy
      ? [h.p([h.Class("muted")], ["Some older results aren't shown."])]
      : []),
  ];

  return controls.length === 0
    ? []
    : [
        h.keyed("div")(
          "search-history-controls",
          [
            h.DataAttribute("search-history-controls", "true"),
            h.Role("status"),
            h.AriaLabel("Older search results"),
            h.AriaLive("polite"),
            h.Style({ display: "grid", gap: "8px", padding: "8px 0" }),
          ],
          controls
        ),
      ];
};
