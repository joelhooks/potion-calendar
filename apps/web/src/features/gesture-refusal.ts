import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";

export const gestureRefusalNotice = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] =>
  Option.match(model.editing.gestureRefusal, {
    onNone: () => [],
    onSome: (reason) => [
      h.section(
        [
          h.Class("gesture-refusal"),
          h.Role("alert"),
          h.AriaLabel(
            model.calendar.navigation.mode === "month"
              ? "Month gesture unavailable"
              : "Calendar gesture unavailable"
          ),
        ],
        [
          h.p(
            [],
            [
              reason === "ReadOnlyEvent"
                ? "You can only view this event, so it can't be moved. Nothing was changed."
                : "This gesture isn't available for this event. Nothing was changed.",
            ]
          ),
          h.button(
            [
              h.Type("button"),
              h.OnClick(
                Message.DismissedGestureRefusal({
                  personId: Option.getOrElse(model.person, () => ""),
                })
              ),
            ],
            ["Dismiss"]
          ),
        ]
      ),
    ],
  });
