import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";
import { calendarReadFailures } from "../layout/calendar-read-state.js";

export const calendarRefreshNotices = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] =>
  calendarReadFailures(model).flatMap((failure) =>
    failure.cached
      ? [
          h.keyed("section")(
            failure.key,
            [
              h.Class("calendar-read-notice"),
              h.Role("alert"),
              h.DataAttribute("calendar-read-key", failure.key),
            ],
            [
              h.p([], [`Couldn't refresh ${failure.calendar.title}`]),
              h.button([h.OnClick(Message.ClickedRefresh())], ["Retry"]),
            ]
          ),
        ]
      : []
  );
