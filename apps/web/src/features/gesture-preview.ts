import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import type { GestureResult } from "../client/editing/gesture-model.js";
import { resolvedAppLocale } from "../layout/app-locale.js";
import { gridGeometry, rangePixels } from "../layout/geometry.js";
import type { TimeGridGeometry } from "../layout/geometry.js";
import { dayFromIso } from "../layout/navigation.js";
import { clockLabel, resolvedTimeFormat } from "../layout/time-format.js";
import type { ResolvedTimeFormat } from "../layout/time-format.js";
import { timedContent } from "../layout/timed-content.js";

const clockMinute = (clock: string): number => {
  const [hour = "0", minute = "0"] = clock.split(":");

  return Number(hour) * 60 + Number(minute);
};

const previewText = (
  h: HtmlBuilder<AppMessage>,
  preview: typeof GestureResult.Type,
  format: ResolvedTimeFormat,
  compact: boolean,
  locale: string
): readonly Html[] => {
  const title = Option.isSome(preview.target)
    ? (preview.target.value.event.title ?? "Event")
    : "New event";

  const label = h.strong([], [preview.duplicate ? `Copy: ${title}` : title]);

  const time = h.span(
    [h.Class("event-time")],
    [
      `${clockLabel(clockMinute(preview.range.startTime), format, locale)}–${clockLabel(clockMinute(preview.range.endTime), format, locale)}`,
    ]
  );

  if (preview.allDayRow) {
    return [label];
  }

  return compact
    ? [h.span([h.Class("timed-readout")], [time, label])]
    : [label, time];
};

export const gesturePreview = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>,
  day: number,
  scale: number,
  allDay: boolean,
  grid: TimeGridGeometry = gridGeometry(scale)
): readonly Html[] => {
  if (Option.isNone(model.editing.gesture)) {
    return [];
  }

  const preview = model.editing.gesture.value;

  if (preview.allDayRow !== allDay) {
    return [];
  }

  const { range } = preview;
  const start = dayFromIso(range.startDate);
  const end = dayFromIso(range.endDate);

  if (
    day < start ||
    day > end ||
    (!allDay && day === end && range.endTime === "00:00")
  ) {
    return [];
  }

  const from = day === start ? clockMinute(range.startTime) : 0;
  const to = day === end ? clockMinute(range.endTime) : 1440;

  const pixels = rangePixels(grid, from, to);
  const height = Math.max(16, pixels.height - 2);
  const content = allDay ? undefined : timedContent(height, "preview");
  const compact = content?.compact === true;

  return [
    h.div(
      [
        h.Class(
          `gesture-preview${allDay ? " gesture-preview-all-day" : ` timed-content timed-content-${compact ? "compact" : "stacked"}`}`
        ),
        h.AriaHidden(true),
        ...(content === undefined
          ? []
          : [
              h.DataAttribute("content-mode", compact ? "compact" : "stacked"),
              h.DataAttribute("content-budget", String(content.budget)),
            ]),
        h.Style(
          allDay
            ? {}
            : {
                ...content?.style,
                height: `${height}px`,
                top: `${pixels.top}px`,
              }
        ),
      ],
      previewText(
        h,
        preview,
        resolvedTimeFormat(model),
        compact,
        resolvedAppLocale(model)
      )
    ),
  ];
};
