import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppMessage } from "../client/app.js";
import { rangePixels, minuteToY, visibleTicks } from "../layout/geometry.js";
import type { TimeGridGeometry } from "../layout/geometry.js";
import type { TimeBlock } from "../layout/time-blocks.js";
import { formatClock } from "../layout/time-format.js";
import type { ResolvedTimeFormat } from "../layout/time-format.js";

export const timeBlockBackground = (
  h: HtmlBuilder<AppMessage>,
  blocks: readonly (typeof TimeBlock.Type)[],
  grid: TimeGridGeometry,
  format: ResolvedTimeFormat
): readonly Html[] => [
  ...blocks.flatMap((block) =>
    block.ranges.map((range) => {
      const pixels = rangePixels(grid, range.startMinute, range.endMinute);

      return h.div([
        h.Class("time-block-fill"),
        h.DataAttribute("block-id", String(block.id)),
        h.AriaHidden(true),
        h.Style({
          background: `color-mix(in srgb, ${block.color} 14%, var(--surface))`,
          height: `${pixels.height}px`,
          top: `${pixels.top}px`,
        }),
      ]);
    })
  ),
  ...grid.segments.flatMap((segment) => {
    if (!segment.hidden) {
      return [];
    }

    const names = blocks
      .flatMap((block) =>
        block.hidden &&
        block.ranges.some(
          (range) =>
            range.startMinute < segment.endMinute &&
            range.endMinute > segment.startMinute
        )
          ? [block.name]
          : []
      )
      .join(", ");

    const label = `Hidden: ${names} · ${formatClock(segment.startMinute, format)}–${formatClock(segment.endMinute, format)}`;

    return [
      h.keyed("div")(
        `${segment.startMinute}:${segment.endMinute}`,
        [
          h.Class("time-block-strip"),
          h.DataAttribute("hidden-start", String(segment.startMinute)),
          h.DataAttribute("hidden-end", String(segment.endMinute)),
          h.Title(label),
          h.AriaLabel(label),
          h.Style({ height: `${segment.height}px`, top: `${segment.top}px` }),
        ],
        [label]
      ),
    ];
  }),
];

export const timeGridTicks = (
  h: HtmlBuilder<AppMessage>,
  grid: TimeGridGeometry
): readonly Html[] =>
  [...visibleTicks(grid), 1440].map((minute) =>
    h.div([
      h.Class("time-grid-tick"),
      h.DataAttribute("minute", String(minute)),
      h.AriaHidden(true),
      h.Style({ top: `${minuteToY(grid, minute) - 1}px` }),
    ])
  );
