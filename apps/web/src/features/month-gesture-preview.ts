import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { resolvedAppLocale } from "../layout/app-locale.js";
import { monthGesturePreview } from "../layout/month-gesture-preview.js";
import { monthMetrics } from "../layout/month.js";
import { clockLabel, resolvedTimeFormat } from "../layout/time-format.js";

const clockMinute = (clock: string) => {
  const [hours = "0", minutes = "0"] = clock.split(":");

  return Number(hours) * 60 + Number(minutes);
};

export const monthPreviewLayer = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>,
  days: readonly number[]
): Html => {
  const preview = Option.getOrUndefined(model.editing.gesture);

  const title =
    preview === undefined
      ? ""
      : Option.match(preview.target, {
          onNone: () => "New event",
          onSome: (target) => target.event.title ?? "Event",
        });

  return h.div(
    [
      h.Class("month-gesture-layer"),
      h.AriaHidden(true),
      h.Style({
        "grid-template-columns": `repeat(${days.length}, minmax(0, 1fr))`,
        left: `${model.settings.showWeekNumbers ? monthMetrics.weekGutter : 0}px`,
      }),
    ],
    monthGesturePreview(model.editing.gesture, [days]).map((fragment) =>
      h.div(
        [
          h.Class(
            `gesture-preview month-gesture-preview${fragment.allDay ? " month-gesture-preview-all-day" : ""}`
          ),
          h.DataAttribute("preview-start-day", String(fragment.startDay)),
          h.DataAttribute("preview-end-day", String(fragment.endDay)),
          h.Style({
            "grid-column": `${fragment.startColumn + 1} / ${fragment.endColumn + 1}`,
            "grid-row": "1",
          }),
        ],
        [
          ...(fragment.allDay || preview === undefined
            ? []
            : [
                h.span(
                  [h.Class("month-preview-time")],
                  [
                    clockLabel(
                      clockMinute(preview.range.startTime),
                      resolvedTimeFormat(model),
                      resolvedAppLocale(model)
                    ),
                  ]
                ),
              ]),
          h.strong([], [`${fragment.duplicate ? "Copy: " : ""}${title}`]),
        ]
      )
    )
  );
};
