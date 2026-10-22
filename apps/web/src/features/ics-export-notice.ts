import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";

export const icsExportNotice = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] =>
  Option.toArray(model.icsExport.notice)
    .filter((notice) => Option.contains(model.person, notice.personId))
    .map((notice) =>
      h.keyed("section")(
        `ics-export-${notice.revision}`,
        [
          h.Class("calendar-read-notice"),
          h.Role("status"),
          h.AriaLive("polite"),
          h.DataAttribute("ics-export-notice", ""),
        ],
        [
          h.p([], [notice.message]),
          h.button(
            [
              h.AriaLabel("Dismiss export notice"),
              h.OnClick(
                Message.DismissedIcsExport({
                  personId: notice.personId,
                  revision: notice.revision,
                })
              ),
            ],
            ["×"]
          ),
        ]
      )
    );
