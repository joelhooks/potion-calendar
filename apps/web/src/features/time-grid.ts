import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";
import { PrepareTimeGrid } from "../client/grid-mount.js";
import { allDayCounts } from "../layout/all-day.js";
import {
  hourHeight,
  minuteInZone,
  timeColumns,
  timeTop,
} from "../layout/geometry.js";
import { dayInZone, visibleDays } from "../layout/navigation.js";
import { layoutTimed } from "../layout/overlap.js";
import {
  allDaySection,
  clockLabel,
  dayLabel,
  visibleEvents,
} from "../layout/presentation.js";
import { chip } from "./calendar.js";

export const timeGrid = (model: AppModel, h: HtmlBuilder<AppMessage>): Html => {
  const days = visibleDays(model.calendar.navigation);
  const events = visibleEvents(model);

  const {
    events: allDay,
    height: allDaySize,
    packed,
    shown,
  } = allDaySection(model);

  const scale = hourHeight(
    model.calendar.zoom,
    model.calendar.viewport,
    allDaySize
  );

  const nowMinute = minuteInZone(model.calendar.now, model.calendar.zone);
  const today = dayInZone(model.calendar.now, model.calendar.zone);
  const counts = allDayCounts(packed, days);
  const column = timeColumns(model.calendar.viewportWidth, days.length);
  const columns = column.template;
  const canCollapse = counts.some((count) => count > 1);

  return h.section(
    [
      h.Class("calendar-view time-view"),
      h.AriaLabel("Time grid"),
      h.OnMount(
        PrepareTimeGrid({ initialMinute: nowMinute, initialScale: scale })
      ),
    ],
    [
      h.div(
        [
          h.Class("day-headers"),
          h.Style({
            "grid-template-columns": columns,
            width: `${column.total}px`,
          }),
        ],
        [
          h.div(
            [h.Class("zone-header"), h.Title(model.calendar.zone)],
            [
              model.calendar.zone.split("/").at(-1)?.replaceAll("_", " ") ??
                model.calendar.zone,
            ]
          ),
          ...days.map((day) =>
            h.div(
              [h.Class(`day-header${day === today ? " is-today" : ""}`)],
              [dayLabel(day, { day: "numeric", weekday: "short" })]
            )
          ),
        ]
      ),
      h.div(
        [
          h.Class("all-day"),
          h.Style({
            "grid-template-columns": columns,
            height: `${allDaySize}px`,
            width: `${column.total}px`,
          }),
        ],
        [
          h.div(
            [h.Class("all-day-gutter")],
            [
              h.span([h.Class("all-day-label")], ["All day"]),
              ...(canCollapse
                ? [
                    h.button(
                      [
                        h.Class("all-day-toggle"),
                        h.OnClick(Message.ClickedAllDay()),
                        h.AriaExpanded(model.calendar.allDayExpanded),
                        h.AriaLabel(
                          model.calendar.allDayExpanded
                            ? "Collapse all-day events"
                            : "Expand all-day events"
                        ),
                      ],
                      [model.calendar.allDayExpanded ? "−" : "+"]
                    ),
                  ]
                : []),
            ]
          ),
          ...days.map((day, index) =>
            h.div(
              [
                h.Class("all-day-cell"),
                h.Style({ "grid-column": String(index + 2), "grid-row": "1" }),
              ],
              model.calendar.allDayExpanded
                ? []
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
                  ]
            )
          ),
          ...(model.calendar.allDayExpanded
            ? shown.flatMap((placement) => {
                const event = allDay.find((item) => item.key === placement.id);

                const covered = days.flatMap((day, index) =>
                  placement.start <= day && day < placement.end ? [index] : []
                );

                const [first] = covered;
                const end = covered.at(-1);

                return event === undefined ||
                  first === undefined ||
                  end === undefined
                  ? []
                  : [
                      chip(h, event, {
                        "grid-column": `${first + 2} / ${end + 3}`,
                        "grid-row": "1",
                        height: "19px",
                        margin: `${3 + placement.row * 21}px 2px 0`,
                        "z-index": event.selected ? "20" : "1",
                      }),
                    ];
              })
            : []),
        ]
      ),
      h.div(
        [
          h.Id("time-viewport"),
          h.Class("time-viewport"),
          h.Style({
            width: `${column.total + model.calendar.scrollbarGutter}px`,
          }),
        ],
        [
          h.div(
            [
              h.Class("time-content"),
              h.Style({
                "--hour-height": `${scale}px`,
                "grid-template-columns": columns,
                height: `${24 * scale}px`,
                width: `${column.total}px`,
              }),
            ],
            [
              h.div(
                [h.Class("time-labels")],
                Array.from({ length: 24 }, (_, hour) =>
                  h.span(
                    [h.Style({ top: `${hour * scale}px` })],
                    [clockLabel(hour * 60)]
                  )
                )
              ),
              h.div(
                [
                  h.Class("day-columns"),
                  h.Style({
                    "grid-column": `2 / ${days.length + 2}`,
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
                        ...placements.flatMap((placement) => {
                          const event = timed.find(
                            (item) => item.key === placement.id
                          );

                          return event === undefined
                            ? []
                            : [
                                chip(h, event, {
                                  height: `${Math.max(16, timeTop(event.endMinute - event.startMinute, scale) - 2)}px`,
                                  left: `calc(${placement.left * 100}% + 1px)`,
                                  position: "absolute",
                                  top: `${timeTop(event.startMinute, scale)}px`,
                                  width: `calc(${placement.width * 100}% - 3px)`,
                                  "z-index": String(placement.paint + 1),
                                }),
                              ];
                        }),
                        ...(day === today
                          ? [
                              h.div([
                                h.Class("now-today"),
                                h.Style({
                                  top: `${timeTop(nowMinute, scale)}px`,
                                }),
                                h.AriaHidden(true),
                              ]),
                            ]
                          : []),
                      ]
                    );
                  }),
                  ...(days.includes(today)
                    ? [
                        h.div([
                          h.Class("now-line"),
                          h.Style({ top: `${timeTop(nowMinute, scale)}px` }),
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

export const monthGrid = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): Html => {
  const days = visibleDays(model.calendar.navigation);
  const events = visibleEvents(model);
  const columns = model.calendar.navigation.hideWeekends ? 5 : 7;

  const rows = Math.max(
    1,
    Math.floor(((model.calendar.viewport - 29) / 6 - 32) / 21)
  );

  const today = dayInZone(model.calendar.now, model.calendar.zone);

  return h.section(
    [h.Class("calendar-view month-view"), h.AriaLabel("Month grid")],
    [
      h.div(
        [
          h.Class("month-weekdays"),
          h.Style({ "grid-template-columns": `repeat(${columns}, 1fr)` }),
        ],
        days
          .slice(0, columns)
          .map((day) => h.div([], [dayLabel(day, { weekday: "short" })]))
      ),
      h.div(
        [
          h.Class("month-cells"),
          h.Style({ "grid-template-columns": `repeat(${columns}, 1fr)` }),
        ],
        days.map((day) => {
          const items = events
            .filter((item) => item.startDay <= day && day < item.endDay)
            .toSorted(
              (a, b) =>
                Number(b.allDay) - Number(a.allDay) ||
                a.startMinute - b.startMinute ||
                a.key.localeCompare(b.key)
            );

          const overflow = items.length > rows;
          const displayed = items.slice(0, overflow ? rows - 1 : rows);

          return h.div(
            [h.Class(`month-cell${day === today ? " is-today" : ""}`)],
            [
              h.button(
                [
                  h.Class("month-date"),
                  h.OnClick(Message.ClickedDate({ day })),
                  h.AriaLabel(dayLabel(day, { dateStyle: "full" })),
                ],
                [dayLabel(day, { day: "numeric" })]
              ),
              ...displayed.map((item) =>
                chip(h, item, { height: "19px", position: "relative" })
              ),
              ...(overflow
                ? [
                    h.button(
                      [
                        h.Class("overflow-count"),
                        h.OnClick(Message.ClickedDate({ day })),
                      ],
                      [`+${items.length - displayed.length} more`]
                    ),
                  ]
                : []),
            ]
          );
        })
      ),
    ]
  );
};
