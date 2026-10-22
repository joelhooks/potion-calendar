import type { SearchEventResultValue } from "@calendar/calendar/contracts";
import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel } from "../client/app.js";
import { eventKey } from "../client/calendar-state.js";
import { Message } from "../client/message.js";
import type { AppMessage } from "../client/message.js";
import { PrepareSearch } from "../client/search/commands.js";
import { minuteInZone } from "../layout/geometry.js";
import { clockLabel, dayLabel } from "../layout/presentation.js";
import {
  searchDays,
  searchAccountFailureLines,
  searchCalendarFailureNotices,
  searchProblemLines,
  searchSelectionKey,
} from "../layout/search-results.js";
import { primarySelection } from "../layout/selection-set.js";
import { resolvedTimeFormat } from "../layout/time-format.js";
import { calendarFailureNotice } from "./search-failures.js";
import { searchPages } from "./search-pages.js";

const searchRow = (
  model: AppModel,
  result: SearchEventResultValue,
  h: HtmlBuilder<AppMessage>
): Html => {
  const key = eventKey(result.event);

  const allDay =
    result.event.start !== undefined && "date" in result.event.start;

  const time = allDay
    ? "All day"
    : `${clockLabel(minuteInZone(result.startMillis, model.calendar.zone), resolvedTimeFormat(model))} – ${clockLabel(minuteInZone(result.endMillis, model.calendar.zone), resolvedTimeFormat(model))}`;

  const selected = Option.contains(
    primarySelection(model.calendar.selected),
    searchSelectionKey(result, model.calendar.mergeDuplicates)
  );

  const title = result.event.title?.trim() ?? "";

  return h.keyed("div")(
    key,
    [h.Style({ position: "relative" })],
    [
      h.button(
        [
          h.Type("button"),
          h.DataAttribute("search-event", key),
          h.AriaPressed(String(selected)),
          h.OnContextMenu(Message.SearchContext({ key })),
          h.Style({
            background: selected
              ? "color-mix(in srgb, currentColor 8%, transparent)"
              : "transparent",
            border: "0",
            "border-bottom":
              "1px solid color-mix(in srgb, currentColor 14%, transparent)",
            color: "inherit",
            cursor: "pointer",
            display: "grid",
            gap: "16px",
            "grid-template-columns": "140px minmax(0, 1fr)",
            padding: "14px 16px",
            "text-align": "left",
            width: "100%",
          }),
        ],
        [
          h.span([], [time]),
          h.div(
            [h.Style({ "min-width": "0" })],
            [
              h.strong(
                [
                  h.Title(title),
                  h.Style({
                    display: "block",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                  }),
                ],
                [title === "" ? "Untitled event" : title]
              ),
              h.p(
                [
                  h.Style({
                    "font-size": "12px",
                    margin: "5px 0 0",
                    opacity: "0.7",
                  }),
                ],
                [result.calendar.title]
              ),
            ]
          ),
        ]
      ),
      ...(Option.isSome(model.search.menu) &&
      model.search.menu.value.key === key
        ? [
            h.div(
              [
                h.Role("menu"),
                h.AriaLabel("Search result actions"),
                h.Style({
                  "border-bottom":
                    "1px solid color-mix(in srgb, currentColor 14%, transparent)",
                  display: "flex",
                  gap: "8px",
                  padding: "8px 16px",
                }),
              ],
              [
                h.button(
                  [
                    h.Role("menuitem"),
                    h.OnClick(Message.SearchSelect({ goTo: false, key })),
                  ],
                  ["Select event"]
                ),
                h.button(
                  [
                    h.Role("menuitem"),
                    h.OnClick(Message.SearchSelect({ goTo: true, key })),
                  ],
                  ["Select and go to event"]
                ),
              ]
            ),
          ]
        : []),
    ]
  );
};

export const searchPanel = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): Html => {
  const response = Option.getOrUndefined(model.search.response);
  const results = response?.results ?? [];
  const groups = searchDays(results, model.calendar.now, model.calendar.zone);

  const searching =
    model.search.text.trim() !== "" &&
    (model.search.phase === "Debouncing" || model.search.phase === "Searching");

  const failures =
    response === undefined ? [] : searchAccountFailureLines(response, model);

  const calendarFailures =
    response === undefined ? [] : searchCalendarFailureNotices(response, model);

  const problems =
    model.search.phase !== "MoreFailed" && Option.isSome(model.search.problem)
      ? searchProblemLines(model.search.problem.value, model)
      : [];

  const empty =
    model.search.phase === "Ready" &&
    results.length === 0 &&
    (response?.pageInfo.length !== 0 ||
      (failures.length === 0 && calendarFailures.length === 0));

  return h.section(
    [
      h.Id("search-panel"),
      h.AriaLabel("Event search"),
      h.OnMount(PrepareSearch({ position: model.search.scroll })),
      h.Style({
        display: "flex",
        flex: "1",
        "flex-direction": "column",
        height: "100%",
        "min-height": "0",
        "min-width": "0",
      }),
    ],
    [
      h.header(
        [h.Style({ padding: "20px 24px 16px" })],
        [
          h.h1(
            [h.Style({ "font-size": "22px", margin: "0 0 14px" })],
            ["Search"]
          ),
          h.div(
            [h.Style({ display: "flex", gap: "8px" })],
            [
              h.input([
                h.Id("search-query"),
                h.Type("search"),
                h.Placeholder("Search events"),
                h.AriaLabel("Search events"),
                h.Spellcheck(false),
                h.Autocapitalize("off"),
                h.Autocomplete("off"),
                h.Value(model.search.text),
                h.OnInput((text) => Message.SearchInput({ text })),
                h.OnKeyDownPreventDefault((key) =>
                  key === "Escape"
                    ? Option.some(Message.SearchEscape())
                    : Option.none()
                ),
                h.Style({
                  background: "transparent",
                  border:
                    "1px solid color-mix(in srgb, currentColor 30%, transparent)",
                  "border-radius": "5px",
                  color: "inherit",
                  flex: "1",
                  "font-size": "15px",
                  "min-width": "0",
                  padding: "10px 12px",
                }),
              ]),
              h.button(
                [
                  h.Id("search-clear"),
                  h.Type("button"),
                  h.OnClick(Message.SearchClear()),
                  h.AriaLabel("Clear search"),
                ],
                ["Clear"]
              ),
            ]
          ),
        ]
      ),
      h.div(
        [
          h.Id("search-results"),
          h.Role("region"),
          h.AriaLabel("Search results"),
          h.OnScroll((position) => Message.SearchScroll({ position })),

          h.Style({
            flex: "1",
            "min-height": "0",
            overflow: "auto",
            padding: "0 24px 24px",
          }),
        ],
        [
          ...[...problems, ...failures].map((line) =>
            h.p([h.DataAttribute("search-failure", "true")], [line])
          ),
          ...calendarFailures.flatMap((failure) =>
            failure.continuation
              ? []
              : [calendarFailureNotice(model, failure, h)]
          ),
          ...(searching ? [h.p([h.Role("status")], ["Searching"])] : []),
          ...(empty ? [h.p([h.Role("status")], ["No results"])] : []),
          ...groups.map((group) =>
            h.keyed("section")(
              String(group.day),
              [h.Id(group.today ? "search-today" : `search-day-${group.day}`)],
              [
                h.h2(
                  [
                    h.Style({
                      "border-bottom":
                        "1px solid color-mix(in srgb, currentColor 20%, transparent)",
                      "font-size": "13px",
                      "font-weight": "600",
                      margin: "0",
                      padding: "16px 0 8px",
                    }),
                  ],
                  [
                    `${group.today ? "Today · " : ""}${dayLabel(group.day, { day: "numeric", month: "long", weekday: "long", year: "numeric" })}`,
                  ]
                ),
                ...(group.noUpcoming ? [h.p([], ["No upcoming results"])] : []),
                ...group.results.map((result) => searchRow(model, result, h)),
              ]
            )
          ),
          ...searchPages(model, h),
        ]
      ),
    ]
  );
};
