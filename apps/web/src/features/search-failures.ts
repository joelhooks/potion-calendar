import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel } from "../client/app.js";
import { Message } from "../client/message.js";
import type { AppMessage } from "../client/message.js";
import { searchScope } from "../client/search/source.js";
import type { searchCalendarFailureNotices } from "../layout/search-results.js";

export const calendarFailureNotice = (
  model: AppModel,
  failure: ReturnType<typeof searchCalendarFailureNotices>[number],
  h: HtmlBuilder<AppMessage>
): Html => {
  const { accountId, calendarId, label, line } = failure;
  const key = JSON.stringify([accountId, calendarId]);

  return h.keyed("p")(
    `search-failure-${key}`,
    [h.DataAttribute("search-failure", "true")],
    [
      h.span([], [line]),
      " ",
      h.button(
        [
          h.Type("button"),
          h.DataAttribute("search-retry-calendar", key),
          h.AriaLabel(`Retry ${label}`),
          h.Disabled(
            model.search.phase !== "Ready" ||
              model.search.responseScope !== searchScope(model)
          ),
          h.OnClick(Message.SearchRetryCalendar({ accountId, calendarId })),
        ],
        ["Retry"]
      ),
    ]
  );
};
