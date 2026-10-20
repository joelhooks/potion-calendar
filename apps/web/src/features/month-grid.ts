import type { Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../client/app.js";
import type { AppModel, AppMessage } from "../client/app.js";
import { PrepareMonthViewport } from "../client/month/viewport.js";
import { resolvedTheme } from "../client/settings/model.js";
import { monthWeekLayout } from "../layout/month-week.js";
import type { MonthWindowFrame } from "../layout/month-window.js";
import { monthWindowWeeks } from "../layout/month-window.js";
import { monthGeometry, monthMetrics, monthWeeks } from "../layout/month.js";
import { dayInZone } from "../layout/navigation.js";
import { dayLabel, visibleEvents } from "../layout/presentation.js";
import { resolvedTimeFormat } from "../layout/time-format.js";
import { chip } from "./calendar.js";

export const monthGrid = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>,
  frame?: typeof MonthWindowFrame.Type,
  prepare: typeof PrepareMonthViewport = PrepareMonthViewport
): Html => {
  const weeks = monthWeeks(model.calendar.navigation, frame);
  const events = visibleEvents(model);

  const geometry = monthGeometry(
    model.calendar.viewport,
    model.settings.showWeekNumbers
  );

  const columns = model.calendar.navigation.hideWeekends ? 5 : 7;
  const template = `${geometry.columnsPrefix}repeat(${columns}, minmax(0, 1fr))`;
  const today = dayInZone(model.calendar.now, model.calendar.zone);

  const appearance = {
    theme: resolvedTheme(model),
    timeFormat: resolvedTimeFormat(model),
  };

  const scroll = (content: Html): Html =>
    frame === undefined
      ? content
      : h.div(
          [
            h.Id("month-viewport"),
            h.Class("month-viewport"),
            h.DataAttribute("month-first-week", String(frame.firstWeek)),
            h.DataAttribute("month-rebase-id", String(frame.revision)),
          ],
          [content]
        );

  return h.section(
    [
      h.Class("calendar-view month-view"),
      h.AriaLabel("Month grid"),
      h.OnMount(prepare()),
    ],
    [
      h.div(
        [
          h.Class("month-weekdays"),
          h.Style(
            frame === undefined
              ? { "grid-template-columns": template }
              : {
                  "grid-template-columns": template,
                  "margin-right": `${model.calendar.scrollbarGutter}px`,
                }
          ),
        ],
        [
          ...(model.settings.showWeekNumbers
            ? [h.span([h.AriaHidden(true)])]
            : []),
          ...(weeks[0]?.days ?? []).map(({ day }) =>
            h.div([], [dayLabel(day, { weekday: "short" })])
          ),
        ]
      ),
      scroll(
        h.div(
          [
            h.Class("month-cells"),
            ...(frame === undefined
              ? []
              : [
                  h.Style({
                    flex: "none",
                    "grid-template-rows": `repeat(${monthWindowWeeks}, ${geometry.rowHeight}px)`,
                    height: `${monthWindowWeeks * geometry.rowHeight}px`,
                    position: "relative",
                  }),
                ]),
          ],
          weeks.map((week) => {
            const layout = monthWeekLayout(
              events,
              week.days,
              geometry.chipRows
            );

            return h.div(
              [
                h.Class(`month-week${week.parked ? " is-parked" : ""}`),
                ...(week.parked
                  ? [h.DataAttribute("month-parked", "true")]
                  : []),
                h.Key(String(week.start)),
                h.DataAttribute("week-start", String(week.start)),
                h.Style({ "grid-template-columns": template }),
              ],
              [
                ...(model.settings.showWeekNumbers
                  ? [
                      h.div(
                        [
                          h.Class("month-week-number"),
                          h.Title(`ISO week ${week.number}`),
                        ],
                        [`W${week.number}`]
                      ),
                    ]
                  : []),
                ...layout.cells.map(
                  ({ day, enabled, displayed, overflow, startRow }) => {
                    if (!enabled) {
                      return h.div([
                        h.Class("month-cell month-cell-unavailable"),
                        h.Key(String(day)),
                        h.AriaHidden(true),
                      ]);
                    }

                    return h.div(
                      [
                        h.Class(
                          `month-cell${day === today ? " is-today" : ""}`
                        ),
                        h.Key(String(day)),
                        h.DataAttribute("day", String(day)),
                      ],
                      [
                        h.button(
                          [
                            h.Class("month-date"),
                            h.OnClick(Message.ClickedDate({ day })),
                            h.AriaLabel(dayLabel(day, { dateStyle: "full" })),
                          ],
                          [dayLabel(day, { day: "numeric" })]
                        ),
                        h.div(
                          [
                            h.Class("month-timed-stack"),
                            h.Style({
                              "padding-top": `${startRow * monthMetrics.chipPitch}px`,
                            }),
                          ],
                          displayed.map((item) =>
                            h.div(
                              [
                                h.Class("month-item month-item-timed"),
                                h.Key(item.key),
                              ],
                              [
                                chip(
                                  h,
                                  item,
                                  {
                                    height: `${monthMetrics.chipHeight}px`,
                                    position: "relative",
                                  },
                                  { ...appearance, timeDisplay: "start" }
                                ),
                              ]
                            )
                          )
                        ),
                        ...(overflow > 0 && geometry.chipRows > 0
                          ? [
                              h.button(
                                [
                                  h.Class("overflow-count"),
                                  h.OnClick(Message.ClickedDate({ day })),
                                  h.Style({
                                    top: `${monthMetrics.dateHeight + (geometry.chipRows - 1) * monthMetrics.chipPitch}px`,
                                  }),
                                  h.AriaLabel(
                                    `Show ${overflow} more events on ${dayLabel(day, { dateStyle: "full" })}`
                                  ),
                                ],
                                [`+${overflow} more`]
                              ),
                            ]
                          : []),
                      ]
                    );
                  }
                ),
                h.div(
                  [
                    h.Class("month-span-layer"),
                    h.Style({
                      "grid-template-columns": `repeat(${columns}, minmax(0, 1fr))`,
                      left: `${model.settings.showWeekNumbers ? monthMetrics.weekGutter : 0}px`,
                    }),
                  ],
                  layout.bars.map((bar) =>
                    h.div(
                      [
                        h.Class("month-span month-item-all-day"),
                        h.Key(bar.item.key),
                        h.DataAttribute("month-span", bar.item.key),
                        h.DataAttribute("start-column", String(bar.start)),
                        h.DataAttribute("end-column", String(bar.end)),
                        h.DataAttribute("span-row", String(bar.row)),
                        h.Style({
                          "grid-column": `${bar.start + 1} / span ${bar.end - bar.start}`,
                          "grid-row": String(bar.row + 1),
                        }),
                      ],
                      [
                        chip(
                          h,
                          bar.item,
                          {
                            height: `${monthMetrics.chipHeight}px`,
                            width: "100%",
                          },
                          appearance
                        ),
                      ]
                    )
                  )
                ),
              ]
            );
          })
        )
      ),
    ]
  );
};
