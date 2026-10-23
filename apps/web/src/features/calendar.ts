import type { CalendarEventValue } from "@calendar/calendar/contracts";
import {
  statusEventType,
  statusEventLabel,
  statusEventProperties,
} from "@calendar/calendar/contracts";
import { Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";
import { calendarKey } from "../client/calendar-state.js";
import { EditorAction } from "../client/editing/editor-action.js";
import { writableCalendar } from "../client/editing/load-editor.js";
import { selectedParticipantEmail } from "../client/email-participants.js";
import { monthNavigation } from "../client/month/host.js";
import { resolvedTheme } from "../client/settings/model.js";
import { TimeZoneAction } from "../client/time-zones/model.js";
import { calendarReadFailures } from "../layout/calendar-read-state.js";
import { conferenceLink } from "../layout/conferencing.js";
import { creatorPresentation } from "../layout/event-creator.js";
import {
  dayInZone,
  maximumDisplayedDays,
  partsFromDay,
  viewLabel,
  visibleDays,
  weekStart,
} from "../layout/navigation.js";
import {
  accountFailure,
  clockLabel,
  dayLabel,
  eventWhen,
  visibleEvents,
} from "../layout/presentation.js";
import type { DisplayEvent } from "../layout/presentation.js";
import { SettingsRoute, printRoute } from "../layout/route.js";
import { chipColors } from "../layout/settings-colors.js";
import { resolvedTimeFormat } from "../layout/time-format.js";
import type { ResolvedTimeFormat } from "../layout/time-format.js";
import type { TimedContent } from "../layout/timed-content.js";
import { bulkDetail } from "./bulk-actions.js";
import {
  eventAttachments,
  eventLinkedText,
  locationMap,
} from "./event-links.js";
import { eventRsvp } from "./event-rsvp.js";

const defaultChipAppearance = { theme: "light", timeFormat: "12" } as const;

interface ChipAppearance {
  readonly phone?: boolean;
  readonly theme: "light" | "dark";
  readonly timeFormat: ResolvedTimeFormat;
  readonly timeDisplay?: "start" | "range";
  readonly resize?: "horizontal-only";
  readonly timedContent?: TimedContent;
}

const chipText = (
  h: HtmlBuilder<AppMessage>,
  item: DisplayEvent,
  appearance: ChipAppearance
): readonly Html[] => {
  const compact = appearance.timedContent?.compact === true;
  const title = h.strong([], [item.title]);

  const time = h.span(
    [h.Class("event-time")],
    [
      compact || appearance.timeDisplay === "start"
        ? clockLabel(item.startMinute, appearance.timeFormat)
        : `${clockLabel(item.startMinute, appearance.timeFormat)}–${clockLabel(item.endMinute, appearance.timeFormat)}`,
    ]
  );

  if (item.allDay) {
    return [title];
  }

  return compact
    ? [h.span([h.Class("timed-readout")], [time, title])]
    : [title, time];
};

const resizeHandles = (
  h: HtmlBuilder<AppMessage>,
  item: DisplayEvent,
  appearance: ChipAppearance
): readonly Html[] => {
  if (
    !(
      item.selected &&
      (appearance.resize !== "horizontal-only" || item.allDay) &&
      (item.calendar.accessRole === "owner" ||
        item.calendar.accessRole === "writer") &&
      (item.source.organizer?.self === true ||
        item.source.guestsCanModify === true)
    )
  ) {
    return [];
  }

  const fine = ["start", "end"].map((edge) =>
    h.span([
      h.Class(
        `resize-handle resize-${edge}${item.allDay ? " resize-horizontal" : ""}`
      ),
      h.DataAttribute("resize-edge", edge),
      h.AriaHidden(true),
    ])
  );

  if (appearance.phone !== true) {
    return fine;
  }

  return [
    ...fine,
    ...["start", "end"].map((edge) =>
      h.span([
        h.Class(`touch-resize-target touch-resize-${edge}`),
        h.DataAttribute("touch-resize-edge", edge),
        h.AriaHidden(true),
      ])
    ),
  ];
};

export const chip = (
  h: HtmlBuilder<AppMessage>,
  item: DisplayEvent,
  style: Record<string, string>,
  appearance: ChipAppearance = defaultChipAppearance
): Html => {
  const colors = chipColors(item.color, appearance.theme);
  const content = appearance.timedContent;
  const compact = content?.compact === true;
  const statusStyle: Record<string, string> = {};

  if (item.selected) {
    statusStyle["--event-selected-primary-fill"] = colors.selectedPrimaryFill;
  }

  if (["declined", "unanswered", "unconfirmed"].includes(item.status)) {
    statusStyle["--event-status-text"] = colors.statusText;
  }

  return h.button(
    [
      h.Class(
        `event-chip status-${item.status}${item.selected ? " selected" : ""}${content === undefined ? "" : ` timed-content timed-content-${compact ? "compact" : "stacked"}`}`
      ),
      h.Style({
        "--event-border": colors.border,
        "--event-color": colors.accent,
        "--event-fill": colors.fill,
        "--event-selected-fill": colors.selectedFill,
        "--event-text": colors.text,
        ...statusStyle,
        ...style,
        ...content?.style,
        "padding-left": `${5 + item.copies.length * 4 + (item.status === "tentative" ? 4 : 0)}px`,
      }),
      h.DataAttribute("event-key", item.key),
      ...(content === undefined
        ? []
        : [
            h.DataAttribute("content-mode", compact ? "compact" : "stacked"),
            h.DataAttribute("content-budget", String(content.budget)),
          ]),
      h.OnClick(Message.ClickedEvent({ key: item.key })),
      h.OnDoubleClick(Message.KeyboardAction({ id: "open-event" })),
      h.AriaLabel(
        `${item.title}, ${item.allDay ? "all day" : `${clockLabel(item.startMinute, appearance.timeFormat)} to ${clockLabel(item.endMinute, appearance.timeFormat)}`}, ${item.copies.map((copy) => copy.calendar.title).join(", ")}, ${item.status}`
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
              "background-color": chipColors(
                copy.calendar.backgroundColor ?? copy.color,
                appearance.theme
              ).accent,
            }),
          ])
        )
      ),
      ...resizeHandles(h, item, appearance),
      ...chipText(h, item, appearance),
    ]
  );
};

export const systemZonePrompt = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] =>
  Option.toArray(model.timeZones.systemPrompt).map((zone) =>
    h.div(
      [
        h.Role("status"),
        h.Class("zone-system-prompt"),
        h.Style({
          background: "var(--surface)",
          border: "1px solid var(--border)",
          "border-radius": "8px",
          "max-width": "min(360px, calc(100vw - 24px))",
          padding: "10px",
          position: "fixed",
          right: "12px",
          top: "64px",
          "white-space": "normal",
          "z-index": "100",
        }),
      ],
      [
        h.p(
          [],
          [`Your system time zone is ${zone}. Change your home time zone?`]
        ),
        h.button(
          [
            h.OnClick(
              Message.TimeZoneAction({
                action: TimeZoneAction.cases.AcceptSystem.make({}),
              })
            ),
          ],
          ["Change home zone"]
        ),
        h.button(
          [
            h.OnClick(
              Message.TimeZoneAction({
                action: TimeZoneAction.cases.DismissSystem.make({}),
              })
            ),
          ],
          ["Keep home zone"]
        ),
      ]
    )
  );

const rangeHeading = (first: number, last: number): string =>
  first === last
    ? dayLabel(first, { day: "numeric", month: "long", year: "numeric" })
    : `${dayLabel(first, { day: "numeric", month: "short" })} – ${dayLabel(last, { day: "numeric", month: "short", year: "numeric" })}`;

export const toolbar = (model: AppModel, h: HtmlBuilder<AppMessage>): Html => {
  const navigation = monthNavigation(model);
  const days = visibleDays(navigation);
  const first = days[0] ?? model.calendar.navigation.anchor;
  const last = days.at(-1) ?? first;

  return h.header(
    [h.Class("toolbar")],
    [
      h.h1([], ["Calendar"]),
      h.button(
        [h.OnClick(Message.ClickedRefresh()), h.Title("Refresh calendars (R)")],
        ["Refresh"]
      ),
      h.button(
        [
          h.OnClick(
            Message.EditingAction({
              action: EditorAction.cases.OpenCreate.make({}),
            })
          ),
          h.Title("Create event (C)"),
        ],
        ["Create"]
      ),
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
          navigation.mode === "month"
            ? dayLabel(navigation.anchor, { month: "long", year: "numeric" })
            : rangeHeading(first, last),
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
              [viewLabel(mode)]
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
              ...Array.from({ length: maximumDisplayedDays }, (_, index) =>
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
  const { anchor } = monthNavigation(model);
  const parts = partsFromDay(anchor);
  const first = anchor - parts.day + 1;
  const start = weekStart(first, model.calendar.navigation.weekStartsOn);

  const weekdays = Array.from(
    { length: 7 },
    (_, index) =>
      ["S", "M", "T", "W", "T", "F", "S"][
        (index + (model.calendar.navigation.weekStartsOn ?? 0)) % 7
      ] ?? ""
  );

  const today = dayInZone(model.calendar.now, model.calendar.zone);
  const displayed = visibleDays(model.calendar.navigation);

  return h.section(
    [h.Class("mini-month"), h.AriaLabel("Date picker")],
    [
      h.h2([], [dayLabel(anchor, { month: "long", year: "numeric" })]),
      h.div(
        [h.Class("mini-days")],
        [
          ...weekdays.map((day) => h.span([h.Class("weekday")], [day])),
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
  const failures = calendarReadFailures(model);

  return h.aside(
    [h.Class("sidebar"), h.AriaLabel("Calendars")],
    [
      miniMonth(model, h),
      h.a(
        [
          h.Class("settings-entry"),
          h.Href(printRoute(SettingsRoute.make({ page: "general" }))),
        ],
        ["Settings"]
      ),
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
            ...(failure === undefined ||
            (failure.kind === "retry" &&
              failures.some((item) => item.calendar.accountId === account.id))
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
              h.div(
                [h.Class("calendar-row")],
                [
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
                          "--event-color": chipColors(
                            calendar.backgroundColor ?? "#4986E8",
                            resolvedTheme(model)
                          ).accent,
                        }),
                      ]),
                      h.span([], [calendar.title]),
                    ]
                  ),
                  ...failures.flatMap((item) =>
                    item.key ===
                      calendarKey(calendar.accountId, calendar.calendarId) &&
                    !item.cached
                      ? [
                          h.p(
                            [h.Class("calendar-load-failure"), h.Role("alert")],
                            [`Couldn't load ${calendar.title}`]
                          ),
                          h.button(
                            [
                              h.Class("calendar-load-retry"),
                              h.OnClick(Message.ClickedRefresh()),
                            ],
                            ["Retry"]
                          ),
                        ]
                      : []
                  ),
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

const emailParticipantButton = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  const email = selectedParticipantEmail(model);

  return [
    h.div(
      [h.Class("email-participants")],
      [
        h.div(
          [
            h.Style({
              "align-items": "center",
              display: "flex",
              "flex-wrap": "wrap",
              gap: "8px",
              "justify-content": "space-between",
              "margin-top": "24px",
            }),
          ],
          [
            h.h3(
              [h.Id("participant-heading"), h.Style({ margin: "0" })],
              ["Attendees"]
            ),
            h.button(
              [
                h.Disabled(email.kind !== "ready"),
                h.OnClick(Message.RequestedEmailParticipants()),
              ],
              ["Email participants"]
            ),
          ]
        ),
        ...(email.kind === "disabled" && email.reason !== undefined
          ? [h.p([h.Class("muted")], [email.reason])]
          : []),
      ]
    ),
  ];
};

const statusEventSummary = (
  event: CalendarEventValue,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  if (!statusEventType(event.eventType)) {
    return [];
  }

  const mode = statusEventProperties(event)?.autoDeclineMode;

  return [
    h.p(
      [
        h.Class("detail-type"),
        h.DataAttribute("saved-event-type", event.eventType ?? "default"),
      ],
      [statusEventLabel(event.eventType)]
    ),
    ...(mode !== undefined && mode !== "declineNone"
      ? [
          h.p(
            [h.Class("detail-status-policy")],
            ["Declines new invitations during this time."]
          ),
        ]
      : []),
  ];
};

export const detailPanel = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>,
  presentation: "panel" | "sheet" = "panel"
): readonly Html[] => {
  if (model.calendar.selected.length > 1) {
    return bulkDetail(model, h, presentation);
  }

  const selected = visibleEvents(model).find((item) => item.selected);

  if (selected === undefined) {
    return [];
  }

  const event = selected.source;
  const status = statusEventType(event.eventType);
  const creator = creatorPresentation(event);

  const writable = model.calendar.calendars.some(
    (calendar) =>
      calendar.accountId === event.accountId &&
      calendar.calendarId === event.calendarId &&
      writableCalendar(calendar)
  );

  const join = status
    ? undefined
    : conferenceLink(event.conferenceUrl, event.location, event.description);

  const when = eventWhen(
    selected,
    model.calendar.zone,
    partsFromDay(dayInZone(model.calendar.now, model.calendar.zone)).year,
    resolvedTimeFormat(model)
  );

  return [
    h.aside(
      [h.Class("detail-panel"), h.AriaLabel("Event details")],
      [
        ...(presentation === "panel"
          ? [
              h.button(
                [
                  h.Class("close-detail"),
                  h.OnClick(Message.ClosedDetail()),
                  h.AriaLabel("Close event details"),
                ],
                ["×"]
              ),
              h.h2([], [selected.title]),
            ]
          : []),
        ...statusEventSummary(event, h),
        ...(writable
          ? []
          : [h.p([h.Class("muted")], ["This calendar is read-only."])]),
        h.div(
          [h.Class("detail-actions")],
          [
            h.button(
              [
                h.Disabled(!writable),
                h.OnClick(
                  Message.EditingAction({
                    action: EditorAction.cases.OpenEdit.make({}),
                  })
                ),
              ],
              ["Edit"]
            ),
            h.button(
              [
                h.OnClick(
                  Message.EditingAction({
                    action: EditorAction.cases.DuplicateSelected.make({}),
                  })
                ),
                h.Title("Duplicate (Mod+D)"),
              ],
              ["Duplicate"]
            ),
            h.button(
              [
                h.Disabled(!writable),
                h.OnClick(
                  Message.EditingAction({
                    action: EditorAction.cases.DeleteSelected.make({}),
                  })
                ),
              ],
              ["Delete"]
            ),
          ]
        ),
        ...eventRsvp(model, h, selected),
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
                  "--event-color": chipColors(
                    copy.calendar.backgroundColor ?? copy.color,
                    resolvedTheme(model)
                  ).accent,
                }),
              ]),
              `${copy.calendar.title}${account === undefined ? "" : ` · ${account.email}`}`,
            ]
          );
        }),
        ...(join === undefined
          ? []
          : [
              h.button(
                [
                  h.Class("join-link"),
                  h.OnClick(
                    Message.RequestedJoinMeeting({ key: Option.none() })
                  ),
                ],
                ["Join meeting ↗"]
              ),
            ]),
        ...(status || event.location === undefined
          ? []
          : [
              h.h3([], ["Location"]),
              h.p([], [eventLinkedText(h, event.location)]),
              ...locationMap(h, event.location, model.settings.locationMaps),
            ]),
        ...(status ? [] : eventAttachments(h, event)),
        ...(status || event.description === undefined
          ? []
          : [
              h.h3([], ["Description"]),
              h.p(
                [h.Class("description")],
                [eventLinkedText(h, event.description)]
              ),
            ]),
        ...(status
          ? []
          : [
              ...emailParticipantButton(model, h),
              h.ul(
                [],
                (event.attendees ?? []).map((person) =>
                  h.li(
                    [],
                    [
                      h.strong([], [person.displayName ?? person.email]),
                      h.span(
                        [],
                        [
                          `${person.self === true ? " · You" : ""}${person.organizer === true ? " · Organizer" : ""}${person === creator.attendee ? " · Creator" : ""}${person.optional === true ? " · Optional" : ""}`,
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
              ...(creator.byline === undefined
                ? []
                : [h.p([h.Class("muted")], [creator.byline])]),
            ]),
      ]
    ),
  ];
};
