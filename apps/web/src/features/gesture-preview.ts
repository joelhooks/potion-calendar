import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { timeTop } from "../layout/geometry.js";
import { dayFromIso } from "../layout/navigation.js";
import { clockLabel, resolvedTimeFormat } from "../layout/time-format.js";

const clockMinute = (clock: string): number => {
  const [hour = "0", minute = "0"] = clock.split(":");

  return Number(hour) * 60 + Number(minute);
};

export const gesturePreview = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>,
  day: number,
  scale: number,
  allDay: boolean
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

  const title = Option.isSome(preview.target)
    ? (preview.target.value.event.title ?? "Event")
    : "New event";

  return [
    h.div(
      [
        h.Class(`gesture-preview${allDay ? " gesture-preview-all-day" : ""}`),
        h.AriaHidden(true),
        h.Style(
          allDay
            ? {}
            : {
                height: `${Math.max(16, timeTop(to - from, scale) - 2)}px`,
                top: `${timeTop(from, scale)}px`,
              }
        ),
      ],
      [
        h.strong([], [preview.duplicate ? `Copy: ${title}` : title]),
        ...(allDay
          ? []
          : [
              h.span(
                [],
                [
                  `${clockLabel(clockMinute(range.startTime), resolvedTimeFormat(model))}–${clockLabel(clockMinute(range.endTime), resolvedTimeFormat(model))}`,
                ]
              ),
            ]),
      ]
    ),
  ];
};
