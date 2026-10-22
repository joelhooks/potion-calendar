import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";
import { EditorView } from "../client/editing/editor-model.js";
import { PrepareGestures } from "../client/editing/gesture-mount.js";
import { gestureHostKey } from "../client/editing/gesture-targets.js";
import { PrepareTimeGrid } from "../client/grid-mount.js";
import { selectionHostKey } from "../client/selection/host.js";
import { resolvedTheme } from "../client/settings/model.js";
import { timeGridGeometry } from "../client/time-blocks/grid.js";
import {
  TimeZoneAction,
  ZoneChooser,
  displayedZones,
} from "../client/time-zones/model.js";
import { zoneDragHostKey, zoneDragScopeKey } from "../client/zone-drag/host.js";
import { PrepareZoneDrag } from "../client/zone-drag/mount.js";
import { allDayCounts } from "../layout/all-day.js";
import {
  minuteInZone,
  minuteToY,
  rangePixels,
  visibleTicks,
} from "../layout/geometry.js";
import { dayInZone, visibleDays } from "../layout/navigation.js";
import { layoutTimed } from "../layout/overlap.js";
import {
  allDaySection,
  dayLabel,
  visibleEvents,
} from "../layout/presentation.js";
import { weekNumber } from "../layout/settings-week.js";
import { resolvedTimeFormat } from "../layout/time-format.js";
import {
  gutterClock,
  gutterReferenceDay,
} from "../layout/time-zones-display.js";
import { zoneColumns } from "../layout/time-zones-grid.js";
import { zoneLabel } from "../layout/time-zones.js";
import { timedContent } from "../layout/timed-content.js";
import { chip } from "./calendar.js";
import { gesturePreview } from "./gesture-preview.js";
import { selectionSurface } from "./selection-surface.js";
import { timeBlockBackground, timeGridTicks } from "./time-block-background.js";

const timeGridBody = (model: AppModel, h: HtmlBuilder<AppMessage>): Html => {
  const days = visibleDays(model.calendar.navigation);
  const events = visibleEvents(model);

  const {
    events: allDay,
    height: allDaySize,
    packed,
    shown,
  } = allDaySection(model);

  const { blocks, grid, scale } = timeGridGeometry(model);

  const nowMinute = minuteInZone(model.calendar.now, model.calendar.zone);
  const today = dayInZone(model.calendar.now, model.calendar.zone);
  const counts = allDayCounts(packed, days);
  const zones = displayedZones(model.timeZones);
  const zoneCount = zones.length;
  const dragKey = zoneDragHostKey(model);
  const { secondary } = model.timeZones.preferences;
  const preview = model.timeZones.drag;

  const origin = Option.isSome(preview)
    ? secondary.findIndex((zone) => zone.id === preview.value.id)
    : -1;

  const insertBoundary =
    Option.isSome(preview) && origin !== -1
      ? preview.value.index + (preview.value.index > origin ? 1 : 0)
      : -1;

  const reference = gutterReferenceDay(days, today);

  const column = zoneColumns(
    model.calendar.viewportWidth,
    days.length,
    zoneCount
  );

  const columns = column.template;
  const stackDayLabels = column.day < 56;
  const canCollapse = counts.some((count) => count > 1);

  return h.section(
    [
      h.Class("calendar-view time-view"),
      h.Style({ "overflow-x": "hidden" }),
      h.AriaLabel("Time grid"),
      h.OnMount(
        PrepareTimeGrid({
          hidden: grid.hidden,
          initialMinute: nowMinute,
          initialScale: scale,
        })
      ),
    ],
    [
      h.div(
        [
          h.Id("time-viewport"),
          h.Class("time-viewport"),
          h.Style({ "overflow-x": "auto", width: "100%" }),
        ],
        [
          h.div(
            [
              h.Class("day-headers"),
              h.DataAttribute(
                "zone-drag-host-key",
                Option.getOrElse(dragKey, () => "")
              ),
              ...Option.toArray(zoneDragScopeKey(model)).map((scopeKey) =>
                h.OnMount(PrepareZoneDrag({ scopeKey }))
              ),
              h.Style({
                background: "var(--surface)",
                "grid-template-columns": columns,
                position: "sticky",
                top: "0",
                width: `${column.total}px`,
                "z-index": "60",
              }),
            ],
            [
              ...zones.map((zone, index) =>
                h.keyed("div")(
                  zone.id,
                  [
                    h.Class("zone-header"),
                    h.Style({
                      background: "var(--surface)",
                      left: `${index * 46}px`,
                      position: "sticky",
                      width: "46px",
                      "z-index": "70",
                    }),
                    h.DataAttribute("zone-id", zone.id),
                    h.Title(
                      `${zoneLabel(zone)} · ${zone.id} · Hour labels for ${dayLabel(reference, { dateStyle: "full" })}`
                    ),
                  ],
                  [
                    h.button(
                      [
                        h.AriaLabel(`Time zone ${zoneLabel(zone)}`),
                        ...(index < secondary.length
                          ? [h.DataAttribute("zone-drag-id", zone.id)]
                          : []),
                        h.OnClick(
                          Message.TimeZoneAction({
                            action: TimeZoneAction.cases.Open.make({
                              chooser: ZoneChooser.cases.Manage.make({
                                id: zone.id,
                              }),
                            }),
                          })
                        ),
                        h.Style({
                          background: "transparent",
                          border: "0",
                          color: "inherit",
                          "font-size": "inherit",
                          overflow: "hidden",
                          padding: "0",
                          "text-overflow": "ellipsis",
                          "white-space": "nowrap",
                          width: "100%",
                        }),
                      ],
                      [zoneLabel(zone)]
                    ),
                    ...(Option.isSome(model.timeZones.temporary) &&
                    zone.id === model.timeZones.preferences.primary.id
                      ? [h.span([h.Style({ display: "block" })], ["Home"])]
                      : []),
                    ...(model.settings.showWeekNumbers &&
                    zone.id === model.calendar.zone
                      ? [
                          h.span(
                            [
                              h.Class("week-number"),
                              h.Title("ISO week number"),
                            ],
                            [
                              `W${weekNumber((days[0] ?? today) + (model.calendar.navigation.mode === "week" ? 3 : 0))}`,
                            ]
                          ),
                        ]
                      : []),
                    ...(index === insertBoundary
                      ? [
                          h.span([
                            h.Class("zone-insert-marker"),
                            h.DataAttribute(
                              "zone-insert-index",
                              String(Option.getOrUndefined(preview)?.index)
                            ),
                            h.AriaHidden(true),
                          ]),
                        ]
                      : []),
                  ]
                )
              ),
              ...days.map((day) =>
                h.div(
                  [
                    h.Class(`day-header${day === today ? " is-today" : ""}`),
                    h.AriaLabel(dayLabel(day, { dateStyle: "full" })),
                    ...(stackDayLabels
                      ? [
                          h.Style({
                            "line-height": "12px",
                            "padding-top": "1px",
                          }),
                        ]
                      : []),
                  ],
                  stackDayLabels
                    ? [
                        h.span(
                          [h.Style({ display: "block" })],
                          [`${dayLabel(day, { day: "numeric" })} `]
                        ),
                        h.span(
                          [h.Style({ display: "block" })],
                          [dayLabel(day, { weekday: "short" })]
                        ),
                      ]
                    : [dayLabel(day, { day: "numeric", weekday: "short" })]
                )
              ),
            ]
          ),
          h.div(
            [
              h.Class("all-day-stack"),
              h.Style({
                background: "var(--surface)",
                display: "grid",
                height: `${allDaySize}px`,
                position: "sticky",
                top: "28px",
                width: `${column.total}px`,
                "z-index": "50",
              }),
            ],
            [
              h.div(
                [
                  h.Class("all-day-gutter"),
                  h.Style({
                    "align-items": "flex-start",
                    background: "var(--surface)",
                    "grid-column": "1",
                    "grid-row": "1",
                    height: `${allDaySize}px`,
                    left: "0",
                    "padding-top": "3px",
                    top: "auto",
                    width: `${zoneCount * 46}px`,
                    "z-index": "40",
                  }),
                ],
                [
                  h.span(
                    [
                      h.Class("all-day-label"),
                      h.Style({
                        display:
                          zoneCount === 1 && canCollapse ? "none" : "inline",
                        "white-space": "nowrap",
                      }),
                    ],
                    ["All day"]
                  ),
                  ...(canCollapse
                    ? [
                        h.button(
                          [
                            h.Class("all-day-toggle"),
                            h.Title(
                              model.calendar.allDayExpanded
                                ? "Collapse all-day events"
                                : "Expand all-day events"
                            ),
                            h.OnClick(Message.ClickedAllDay()),
                            h.AriaExpanded(model.calendar.allDayExpanded),
                            h.AriaLabel(
                              model.calendar.allDayExpanded
                                ? "Collapse all-day events"
                                : "Expand all-day events"
                            ),
                          ],
                          [model.calendar.allDayExpanded ? "▴" : "▾"]
                        ),
                      ]
                    : []),
                ]
              ),
              h.div(
                [
                  h.Class("all-day"),
                  h.Style({
                    "grid-column": "1",
                    "grid-row": "1",
                    "grid-template-columns": columns,
                    height: `${allDaySize}px`,
                    width: `${column.total}px`,
                  }),
                ],
                [
                  ...days.map((day, index) =>
                    h.div(
                      [
                        h.Class("all-day-cell"),
                        h.DataAttribute("day", String(day)),
                        h.Style({
                          "grid-column": String(index + zoneCount + 1),
                          "grid-row": "1",
                        }),
                      ],
                      model.calendar.allDayExpanded
                        ? gesturePreview(model, h, day, scale, true)
                        : [
                            h.button(
                              [
                                h.OnClick(Message.ClickedAllDay()),
                                h.AriaLabel(
                                  `${counts[index] ?? 0} all-day events on ${dayLabel(day, { dateStyle: "full" })}`
                                ),
                              ],
                              [String(counts[index] ?? 0)]
                            ),
                            ...gesturePreview(model, h, day, scale, true),
                          ]
                    )
                  ),
                  ...(model.calendar.allDayExpanded
                    ? shown.flatMap((placement) => {
                        const event = allDay.find(
                          (item) => item.key === placement.id
                        );

                        const covered = days.flatMap((day, index) =>
                          placement.start <= day && day < placement.end
                            ? [index]
                            : []
                        );

                        const [first] = covered;
                        const end = covered.at(-1);

                        return event === undefined ||
                          first === undefined ||
                          end === undefined
                          ? []
                          : [
                              chip(
                                h,
                                event,
                                {
                                  "grid-column": `${first + zoneCount + 1} / ${end + zoneCount + 2}`,
                                  "grid-row": "1",
                                  height: "19px",
                                  margin: `${3 + placement.row * 21}px 2px 0`,
                                  "z-index": event.selected ? "20" : "1",
                                },
                                {
                                  theme: resolvedTheme(model),
                                  timeFormat: resolvedTimeFormat(model),
                                }
                              ),
                            ];
                      })
                    : []),
                ]
              ),
            ]
          ),
          h.div(
            [
              h.Class("time-content"),
              h.Style({
                "--hour-height": `${scale}px`,
                "grid-template-columns": columns,
                height: `${grid.height}px`,
                width: `${column.total}px`,
                "z-index": "0",
              }),
            ],
            [
              ...zones.map((zone, index) =>
                h.keyed("div")(
                  zone.id,
                  [
                    h.Class("time-labels"),
                    h.DataAttribute("zone-id", zone.id),
                    h.DataAttribute("reference-day", String(reference)),
                    h.Style({
                      background: "var(--surface)",
                      "grid-column": String(index + 1),
                      "grid-row": "1",
                      left: `${index * 46}px`,
                      position: "sticky",
                      "z-index": "30",
                    }),
                  ],
                  visibleTicks(grid).map((minute) =>
                    h.span(
                      [
                        h.DataAttribute("minute", String(minute)),
                        h.Style({
                          "padding-top": minute === 0 ? "3px" : "0",
                          top: `${minuteToY(grid, minute)}px`,
                          transform: minute === 0 ? "none" : "translateY(-50%)",
                        }),
                      ],
                      [
                        gutterClock(
                          reference,
                          minute / 60,
                          model.calendar.zone,
                          zone.id,
                          resolvedTimeFormat(model)
                        ),
                      ]
                    )
                  )
                )
              ),
              h.div(
                [
                  h.Class("day-columns"),
                  h.Style({
                    "grid-column": `${zoneCount + 1} / ${days.length + zoneCount + 1}`,
                    "grid-template-columns": `repeat(${days.length}, ${column.day}px)`,
                  }),
                ],
                [
                  ...days.map((day) => {
                    const timed = events.filter(
                      (item) => !item.allDay && item.startDay === day
                    );

                    const placements = layoutTimed(
                      timed.map((item) => ({
                        end: item.endMinute,
                        id: item.key,
                        selected: item.selected,
                        start: item.startMinute,
                      }))
                    );

                    return h.div(
                      [
                        h.Class(
                          `day-column${day === today ? " today-column" : ""}`
                        ),
                        h.DataAttribute("day", String(day)),
                      ],
                      [
                        ...timeBlockBackground(
                          h,
                          blocks,
                          grid,
                          resolvedTimeFormat(model)
                        ),
                        ...gesturePreview(model, h, day, scale, false, grid),
                        ...placements.flatMap((placement) => {
                          const event = timed.find(
                            (item) => item.key === placement.id
                          );

                          if (event === undefined) {
                            return [];
                          }

                          const pixels = rangePixels(
                            grid,
                            event.startMinute,
                            event.endMinute
                          );

                          const height = Math.max(16, pixels.height - 2);

                          return [
                            chip(
                              h,
                              event,
                              {
                                height: `${height}px`,
                                left: `calc(${placement.left * 100}% + 1px)`,
                                position: "absolute",
                                top: `${pixels.top}px`,
                                width: `calc(${placement.width * 100}% - 3px)`,
                                "z-index": String(placement.paint + 1),
                              },
                              {
                                theme: resolvedTheme(model),
                                timeFormat: resolvedTimeFormat(model),
                                timedContent: timedContent(height, "chip"),
                              }
                            ),
                          ];
                        }),
                        ...(day === today
                          ? [
                              h.div([
                                h.Class("now-today"),
                                h.Style({
                                  top: `${minuteToY(grid, nowMinute)}px`,
                                }),
                                h.AriaHidden(true),
                              ]),
                            ]
                          : []),
                      ]
                    );
                  }),
                  ...timeGridTicks(h, grid),
                  ...(days.includes(today)
                    ? [
                        h.div([
                          h.Class("now-line"),
                          h.Style({ top: `${minuteToY(grid, nowMinute)}px` }),
                          h.AriaHidden(true),
                        ]),
                      ]
                    : []),
                ]
              ),
            ]
          ),
        ]
      ),
    ]
  );
};

export const timeGrid = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>,
  prepare: typeof PrepareGestures = PrepareGestures
): Html => {
  const { grid, scale } = timeGridGeometry(model);

  const hostKey = gestureHostKey(
    Option.getOrElse(model.person, () => ""),
    model.calendar.zone,
    scale,
    grid.hidden
  );

  return h.keyed("div")(
    hostKey,
    [
      h.Id("gesture-host"),
      h.DataAttribute(
        "selection-count",
        String(model.calendar.selected.length)
      ),
      h.DataAttribute("gesture-host-key", hostKey),
      h.Class("gesture-host"),
      h.Style({ display: "contents" }),
      ...(Option.isSome(model.person) &&
      EditorView.guards.Closed(model.editing.view)
        ? [
            h.OnMount(
              prepare({
                hidden: grid.hidden,
                hostKey,
                personId: model.person.value,
                scale,
              })
            ),
          ]
        : []),
    ],
    [
      selectionSurface(model, h, selectionHostKey(model), [
        timeGridBody(model, h),
      ]),
    ]
  );
};

export { monthGrid } from "./month-grid.js";
