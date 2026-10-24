import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel } from "../client/app.js";
import { Message } from "../client/message.js";
import type { AppMessage } from "../client/message.js";
import {
  forwardSearchExhausted,
  forwardSearchTargets,
} from "../client/search/paging.js";
import { searchScope } from "../client/search/source.js";
import {
  searchCalendarFailureNotices,
  searchProblemLines,
} from "../layout/search-results.js";
import { calendarFailureNotice } from "./search-failures.js";

const searchPageState = (model: AppModel) => {
  const response = Option.getOrUndefined(model.search.response);

  const busy =
    model.search.phase === "Debouncing" ||
    model.search.phase === "Searching" ||
    model.search.phase === "LoadingMore";

  const current = model.search.responseScope === searchScope(model);
  const ready = current && model.search.phase === "Ready";
  const failedMore = current && model.search.phase === "MoreFailed";

  const failedSearch =
    model.search.phase === "Failed" ||
    (response?.accountFailures.length ?? 0) > 0;

  const available =
    current &&
    response !== undefined &&
    forwardSearchTargets(response).length > 0;

  const exhausted =
    response !== undefined && ready && forwardSearchExhausted(response);

  const unknown =
    response?.pageInfo.some(
      (page) => page.forwardHasMore && page.forwardNextPageToken === undefined
    ) ?? false;

  return {
    available,
    busy,
    exhausted,
    failedMore,
    failedSearch,
    ready,
    unknown,
  };
};

export const searchPages = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  const {
    busy,
    ready,
    failedMore,
    failedSearch,
    available,
    exhausted,
    unknown,
  } = searchPageState(model);

  const button = (
    key: string,
    disabled: boolean,
    message: AppMessage,
    label: string
  ): Html =>
    h.keyed("button")(
      key,
      [h.Type("button"), h.Disabled(disabled), h.OnClick(message)],
      [label]
    );

  const response = Option.getOrUndefined(model.search.response);

  const failures =
    response === undefined
      ? []
      : searchCalendarFailureNotices(response, model).flatMap((failure) =>
          failure.continuation && !failure.reverse
            ? [calendarFailureNotice(model, failure, h)]
            : []
        );

  const problems =
    failedMore && Option.isSome(model.search.problem)
      ? searchProblemLines(model.search.problem.value, model)
      : [];

  const controls = [
    ...failures,
    ...problems.map((line) =>
      h.p([h.DataAttribute("search-failure", "true")], [line])
    ),
    ...(failedMore
      ? [
          button(
            "retry-more",
            false,
            Message.SearchRetryMore(),
            "Retry loading more"
          ),
        ]
      : []),
    ...(failedSearch
      ? [button("retry-search", busy, Message.SearchRetry(), "Retry search")]
      : []),
    ...(available
      ? [button("load-more", !ready, Message.SearchMore(), "Load more")]
      : []),
    ...(model.search.phase === "LoadingMore"
      ? [h.p([], ["Loading more"])]
      : []),
    ...(exhausted ? [h.p([], ["No more results"])] : []),
    ...(unknown
      ? [
          h.p(
            [h.Class("muted")],
            ["Showing the first results for some calendars"]
          ),
        ]
      : []),
  ];

  return controls.length === 0
    ? []
    : [
        h.keyed("div")(
          "search-page-controls",
          [
            h.DataAttribute("search-page-controls", "true"),
            h.Role("status"),
            h.AriaLive("polite"),
            h.Style({ display: "grid", gap: "8px", padding: "16px 0" }),
          ],
          controls
        ),
      ];
};
