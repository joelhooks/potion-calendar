import { Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";
import { calendarKey } from "../client/calendar-state.js";
import { conferenceLink } from "../layout/conferencing.js";
import { dayInZone, partsFromDay, visibleDays } from "../layout/navigation.js";
import {
  accountFailure,
  clockLabel,
  dayLabel,
  eventWhen,
  visibleEvents,
} from "../layout/presentation.js";
import type { DisplayEvent } from "../layout/presentation.js";

export const chip = (
  h: HtmlBuilder<AppMessage>,
  item: DisplayEvent,
  style: Record<string, string>
): Html =>
  h.button(
    [
      h.Class(
        `event-chip status-${item.status}${item.selected ? " selected" : ""}`
      ),
      h.Style({
        "--event-color": item.color,
        ...style,
        "padding-left": `${5 + item.copies.length * 4 + (item.status === "tentative" ? 4 : 0)}px`,
      }),
      h.DataAttribute("event-key", item.key),
      h.OnClick(Message.ClickedEvent({ key: item.key })),
      h.AriaLabel(
        `${item.title}, ${item.allDay ? "all day" : `${clockLabel(item.startMinute)} to ${clockLabel(item.endMinute)}`}, ${item.copies.map((copy) => copy.calendar.title).join(", ")}, ${item.status}`
      ),
    ],
    [
      h.span(
        [
          h.Class("calendar-ribbons"),
          h.AriaHidden(true),
          h.Style({ left: item.status === "tentative" ? "4px" : "0" }),
        ],
        item.copies.map((copy) =>
          h.span([
            h.Class("calendar-ribbon"),
            h.DataAttribute(
              "calendar-key",
              calendarKey(copy.calendar.accountId, copy.calendar.calendarId)
            ),
            h.Title(copy.calendar.title),
            h.Style({
              "background-color": copy.calendar.backgroundColor ?? copy.color,
            }),
          ])
        )
      ),
      h.strong([], [item.title]),
      ...(item.allDay
        ? []
        : [
            h.span(
              [h.Class("event-time")],
              [`${clockLabel(item.startMinute)}–${clockLabel(item.endMinute)}`]
            ),
          ]),
    ]
  );

export const toolbar = (model: AppModel, h: HtmlBuilder<AppMessage>): Html => {
  const days = visibleDays(model.calendar.navigation);
  const first = days[0] ?? model.calendar.navigation.anchor;
  const last = days.at(-1) ?? first;

  return h.header(
    [h.Class("toolbar")],
    [
      h.h1([], ["Calendar"]),
      h.button(
        [h.OnClick(Message.ClickedToday()), h.Title("Today (T)")],
        ["Today"]
      ),
      h.button(
        [
          h.OnClick(Message.ClickedPage({ direction: -1 })),
          h.AriaLabel("Previous period"),
        ],
        ["‹"]
      ),
      h.button(
        [
          h.OnClick(Message.ClickedPage({ direction: 1 })),
          h.AriaLabel("Next period"),
        ],
        ["›"]
      ),
      h.h2(
        [],
        [
          first === last
            ? dayLabel(first, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })
            : `${dayLabel(first, { day: "numeric", month: "short" })} – ${dayLabel(last, { day: "numeric", month: "short", year: "numeric" })}`,
        ]
      ),
      h.div(
        [h.Class("view-controls")],
        [
          ...(["day", "week", "month"] as const).map((mode) =>
            h.button(
              [
                h.OnClick(Message.ClickedView({ days: 7, mode })),
                h.AriaPressed(String(model.calendar.navigation.mode === mode)),
              ],
              [mode[0]?.toUpperCase() + mode.slice(1)]
            )
          ),
          h.select(
            [
              h.AriaLabel("Displayed days"),
              h.Value(
                model.calendar.navigation.mode === "days"
                  ? String(model.calendar.navigation.days)
                  : ""
              ),
              h.OnChange((value) =>
                Message.ClickedView({ days: Number(value), mode: "days" })
              ),
            ],
            [
              h.option([h.Value(""), h.Disabled(true)], ["Days…"]),
              ...Array.from({ length: 9 }, (_, index) =>
                h.option(
                  [h.Value(String(index + 1))],
                  [`${index + 1} day${index === 0 ? "" : "s"}`]
                )
              ),
            ]
          ),
        ]
      ),
    ]
  );
};

const miniMonth = (model: AppModel, h: HtmlBuilder<AppMessage>): Html => {
  const { anchor } = model.calendar.navigation;
  const parts = partsFromDay(anchor);
  const first = anchor - parts.day + 1;
  const start = first - partsFromDay(first).weekDay;
  const today = dayInZone(model.calendar.now, model.calendar.zone);
  const displayed = visibleDays(model.calendar.navigation);

  return h.section(
    [h.Class("mini-month"), h.AriaLabel("Date picker")],
    [
      h.h2([], [dayLabel(anchor, { month: "long", year: "numeric" })]),
      h.div(
        [h.Class("mini-days")],
        [
          ...["S", "M", "T", "W", "T", "F", "S"].map((day) =>
            h.span([h.Class("weekday")], [day])
          ),
          ...Array.from({ length: 42 }, (_, index) => {
            const day = start + index;

            return h.button(
              [
                h.Class(
                  `${partsFromDay(day).month === parts.month ? "" : "other-month "}${displayed.includes(day) ? "in-range " : ""}${day === today ? "is-today" : ""}`
                ),
                h.OnClick(Message.ClickedDate({ day })),
                h.AriaLabel(dayLabel(day, { dateStyle: "full" })),
              ],
              [String(partsFromDay(day).day)]
            );
          }),
        ]
      ),
    ]
  );
};

export const sidebar = (model: AppModel, h: HtmlBuilder<AppMessage>): Html => {
  const session = AsyncData.getData(model.session);

  const accounts =
    Option.isSome(session) && session.value !== null
      ? session.value.accounts
      : [];

  const indexError = AsyncData.getError(model.calendar.index);

  return h.aside(
    [h.Class("sidebar"), h.AriaLabel("Calendars")],
    [
      miniMonth(model, h),
      ...accounts.map((account) => {
        const read = model.calendar.reads.find(
          (item) => item.accountId === account.id
        );

        const failure = account.disconnected
          ? { kind: "reconnect", message: "Reconnect this Google account." }
          : accountFailure(model, account.id);

        const calendars = model.calendar.calendars.filter(
          (item) => item.accountId === account.id
        );

        return h.keyed("section")(
          account.id,
          [h.Class("account"), h.DataAttribute("account-id", account.id)],
          [
            h.h2([], [account.email]),
            ...(read !== undefined && AsyncData.isPending(read.events)
              ? [h.p([h.Class("muted"), h.Role("status")], ["Loading events…"])]
              : []),
            ...(failure === undefined
              ? []
              : [
                  h.p([h.Role("alert")], [failure.message]),
                  h.button(
                    [
                      h.OnClick(
                        failure.kind === "reconnect"
                          ? Message.ClickedAddGoogle()
                          : Message.ClickedRetry({ accountId: account.id })
                      ),
                    ],
                    [failure.kind === "reconnect" ? "Reconnect" : "Retry"]
                  ),
                ]),
            ...calendars.map((calendar) =>
              h.button(
                [
                  h.Class("calendar-toggle"),
                  h.Role("checkbox"),
                  h.AriaChecked(
                    !model.calendar.hidden.includes(
                      calendarKey(calendar.accountId, calendar.calendarId)
                    )
                  ),
                  h.OnClick(
                    Message.ClickedCalendar({
                      accountId: calendar.accountId,
                      calendarId: calendar.calendarId,
                    })
                  ),
                ],
                [
                  h.span([
                    h.Class(
                      `swatch${model.calendar.hidden.includes(calendarKey(calendar.accountId, calendar.calendarId)) ? " hidden" : ""}`
                    ),
                    h.Style({
                      "--event-color": calendar.backgroundColor ?? "#4986E8",
                    }),
                  ]),
                  h.span([], [calendar.title]),
                ]
              )
            ),
          ]
        );
      }),
      ...(AsyncData.isPending(model.calendar.index)
        ? [h.p([h.Role("status")], ["Loading calendars…"])]
        : []),
      ...(Option.isNone(indexError)
        ? []
        : [
            h.p([h.Role("alert")], [indexError.value.message]),
            h.button(
              [h.OnClick(Message.ClickedRetry({ accountId: "" }))],
              ["Retry calendars"]
            ),
          ]),
      h.button(
        [
          h.Class("add-account"),
          h.OnClick(Message.ClickedAddGoogle()),
          h.Disabled(model.action === "pending"),
        ],
        ["+ Add Google account"]
      ),
      h.div(
        [h.Class("display-options")],
        [
          h.button(
            [
              h.OnClick(Message.ClickedWeekends()),
              h.AriaPressed(String(model.calendar.navigation.hideWeekends)),
            ],
            [
              model.calendar.navigation.hideWeekends
                ? "Show weekends"
                : "Hide weekends",
            ]
          ),
          h.button(
            [
              h.OnClick(Message.ClickedDeclined()),
              h.AriaPressed(String(model.calendar.hideDeclined)),
            ],
            [model.calendar.hideDeclined ? "Show declined" : "Hide declined"]
          ),
          h.button(
            [
              h.Class("merge-toggle"),
              h.Role("checkbox"),
              h.AriaChecked(model.calendar.mergeDuplicates),
              h.OnClick(Message.ClickedMergeDuplicates()),
            ],
            [
              h.span(
                [h.Class("merge-check"), h.AriaHidden(true)],
                [model.calendar.mergeDuplicates ? "✓" : ""]
              ),
              "Merge duplicate events",
            ]
          ),
          h.div(
            [h.Class("zoom-controls")],
            [
              h.button(
                [
                  h.OnClick(Message.ClickedZoom({ step: -1 })),
                  h.AriaLabel("Zoom hours out"),
                ],
                ["−"]
              ),
              h.button(
                [
                  h.OnClick(Message.ClickedZoom({ step: 0 })),
                  h.AriaLabel("Reset hour zoom"),
                ],
                ["Hours"]
              ),
              h.button(
                [
                  h.OnClick(Message.ClickedZoom({ step: 1 })),
                  h.AriaLabel("Zoom hours in"),
                ],
                ["+"]
              ),
            ]
          ),
        ]
      ),
      h.button(
        [
          h.Class("sign-out"),
          h.OnClick(Message.ClickedSignOut()),
          h.Disabled(model.action === "pending"),
        ],
        ["Sign out"]
      ),
    ]
  );
};

export const detailPanel = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  const selected = visibleEvents(model).find((item) => item.selected);

  if (selected === undefined) {
    return [];
  }

  const event = selected.source;

  const join = conferenceLink(
    event.conferenceUrl,
    event.location,
    event.description
  );

  const when = eventWhen(
    selected,
    model.calendar.zone,
    partsFromDay(dayInZone(model.calendar.now, model.calendar.zone)).year
  );

  return [
    h.aside(
      [h.Class("detail-panel"), h.AriaLabel("Event details")],
      [
        h.button(
          [
            h.Class("close-detail"),
            h.OnClick(Message.ClosedDetail()),
            h.AriaLabel("Close event details"),
          ],
          ["×"]
        ),
        h.h2([], [selected.title]),
        h.p([h.Class("detail-date")], [when.date]),
        ...(when.time === undefined
          ? []
          : [h.p([h.Class("detail-time")], [when.time])]),
        h.h3([], [selected.copies.length === 1 ? "Calendar" : "Calendars"]),
        ...selected.copies.map((copy) => {
          const session = Option.getOrUndefined(
            AsyncData.getData(model.session)
          );

          const account = session?.accounts.find(
            (item) => item.id === copy.calendar.accountId
          );

          return h.p(
            [
              h.Class("detail-calendar"),
              h.DataAttribute(
                "calendar-key",
                calendarKey(copy.calendar.accountId, copy.calendar.calendarId)
              ),
            ],
            [
              h.span([
                h.Class("swatch"),
                h.Style({
                  "--event-color": copy.calendar.backgroundColor ?? copy.color,
                }),
              ]),
              `${copy.calendar.title}${account === undefined ? "" : ` · ${account.email}`}`,
            ]
          );
        }),
        ...(join === undefined
          ? []
          : [
              h.a(
                [
                  h.Class("join-link"),
                  h.Href(join),
                  h.Target("_blank"),
                  h.Rel("noopener noreferrer"),
                ],
                ["Join meeting ↗"]
              ),
            ]),
        ...(event.location === undefined
          ? []
          : [h.h3([], ["Location"]), h.p([], [event.location])]),
        ...(event.description === undefined
          ? []
          : [
              h.h3([], ["Description"]),
              h.p([h.Class("description")], [event.description]),
            ]),
        ...(event.attendees === undefined
          ? []
          : [
              h.h3([], ["Attendees"]),
              h.ul(
                [],
                event.attendees.map((person) =>
                  h.li(
                    [],
                    [
                      h.strong([], [person.displayName ?? person.email]),
                      h.span(
                        [],
                        [
                          `${person.self === true ? " · You" : ""}${person.organizer === true ? " · Organizer" : ""}${person.optional === true ? " · Optional" : ""}`,
                        ]
                      ),
                      h.span(
                        [h.Class("attendee-response")],
                        [person.responseStatus ?? "needsAction"]
                      ),
                    ]
                  )
                )
              ),
            ]),
        ...(event.attendeesOmitted === true
          ? [
              h.p(
                [h.Class("muted")],
                ["The provider has not shared the complete attendee list."]
              ),
            ]
          : []),
      ]
    ),
  ];
};
