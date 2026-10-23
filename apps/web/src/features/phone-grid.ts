import type { Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../client/message.js";
import type { AppMessage } from "../client/message.js";
import { dayLabel } from "../layout/presentation.js";

export const phoneMonthCell = (
  h: HtmlBuilder<AppMessage>,
  day: number,
  today: number,
  count: number
): Html =>
  h.div(
    [
      h.Class(`month-cell${day === today ? " is-today" : ""}`),
      h.Key(String(day)),
      h.DataAttribute("day", String(day)),
      h.DataAttribute("phone-month-count", String(count)),
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
      ...(count === 0
        ? []
        : [
            h.button(
              [
                h.Class("phone-month-summary"),
                h.OnClick(Message.ClickedDate({ day })),
                h.AriaLabel(
                  `Show ${count} ${count === 1 ? "event" : "events"} on ${dayLabel(day, { dateStyle: "full" })}`
                ),
                h.Style({
                  display: "block",
                  "font-size": "12px",
                  margin: "0 auto",
                  "min-width": "44px",
                  padding: "0",
                  width: "44px",
                }),
              ],
              [
                h.span(
                  [h.AriaHidden(true)],
                  [count === 1 ? "●" : String(count)]
                ),
              ]
            ),
          ]),
    ]
  );
