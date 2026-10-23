import { Match } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";
import { monthNavigation } from "../client/month/host.js";
import { visibleDays } from "../layout/navigation.js";
import { dayLabel, visibleEvents } from "../layout/presentation.js";
import { detailPanel, sidebar } from "./calendar.js";
import { upcomingMeetingPanel } from "./upcoming-meeting.js";

const phoneStyles = `
html,body { max-width:100%; overflow-x:hidden; }
.phone-toolbar { flex:none; padding:8px 12px; border-bottom:1px solid var(--line); }
.phone-toolbar h2 { font-size:18px; line-height:26px; padding:0 0 6px; overflow-wrap:anywhere; }
.phone-navigation,.phone-actions { display:flex; gap:6px; align-items:center; }
.phone-actions { margin-top:6px; }
.phone-toolbar button,.phone-toolbar select { min-height:44px; min-width:44px; }
.phone-toolbar select { flex:1; min-width:0; }
.phone-actions button { flex:1; padding:5px 6px; }
.app .workspace { width:100%; min-width:0; }
.app .calendar-view,.app .month-view { min-width:0; width:100%; }
.app button,.app select,.app input[type=checkbox] { min-height:44px; min-width:44px; }
.app input:not([type=checkbox]),.app textarea,.app select { font-size:16px; }
.phone-shell-dialog { color:var(--text); background:var(--surface); border:1px solid var(--line); padding:12px; max-height:calc(100dvh - 24px); max-width:calc(100vw - 24px); overflow:auto; }
.phone-shell-dialog::backdrop { background:rgb(0 0 0 / 35%); }
.phone-shell-dialog[data-phone-shell-dialog=drawer] { margin:0; height:100dvh; max-height:100dvh; width:min(352px,calc(100vw - 24px)); }
.phone-shell-dialog .sidebar { display:block; width:100%; padding:12px 0; border:0; overflow:visible; }
.phone-shell-dialog .mini-days button { width:44px; height:44px; padding:0; }
.phone-shell-dialog .detail-panel,.phone-shell-dialog .upcoming-panel { position:static; display:block; width:100%; padding:12px 0 0; border:0; background:transparent; }
.phone-shell-dialog[data-phone-shell-dialog=details],.phone-shell-dialog[data-phone-shell-dialog=upcoming] { margin:auto 0 0; width:100%; max-width:100vw; max-height:75dvh; border-radius:16px 16px 0 0; padding:12px 16px calc(16px + env(safe-area-inset-bottom)); }
.phone-panel-header { display:flex; align-items:center; justify-content:space-between; gap:12px; padding-bottom:12px; border-bottom:1px solid var(--line); }
.phone-panel-header h2 { min-width:0; font-size:18px; overflow-wrap:anywhere; }
.phone-sheet-close { flex:none; min-width:44px; min-height:44px; }
`;

export const phoneToolbar = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): Html => {
  const navigation = monthNavigation(model);
  const days = visibleDays(navigation);
  const first = days[0] ?? navigation.anchor;
  const last = days.at(-1) ?? first;

  const range =
    first === last
      ? dayLabel(first, { day: "numeric", month: "long", year: "numeric" })
      : `${dayLabel(first, { day: "numeric", month: "short" })} – ${dayLabel(last, { day: "numeric", month: "short", year: "numeric" })}`;

  const title =
    navigation.mode === "month"
      ? dayLabel(navigation.anchor, { month: "long", year: "numeric" })
      : range;

  const selected = visibleEvents(model).some((event) => event.selected);

  return h.header(
    [h.Class("phone-toolbar")],
    [
      h.style([], [phoneStyles]),
      h.h2([], [title]),
      h.div(
        [h.Class("phone-navigation")],
        [
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
          h.button([h.OnClick(Message.ClickedToday())], ["Today"]),
          h.select(
            [
              h.AriaLabel("Calendar view"),
              h.Value(
                navigation.mode === "days"
                  ? String(navigation.days)
                  : navigation.mode
              ),
              h.OnChange((value) => {
                if (value === "day" || value === "week" || value === "month") {
                  return Message.ClickedView({ days: 7, mode: value });
                }

                return Message.ClickedView({
                  days: Number(value),
                  mode: "days",
                });
              }),
            ],
            [
              h.option([h.Value("day")], ["Day"]),
              h.option([h.Value("week")], ["Week"]),
              h.option([h.Value("month")], ["Month"]),
              ...Array.from({ length: 31 }, (_, index) =>
                h.option([h.Value(String(index + 1))], [`${index + 1} days`])
              ),
            ]
          ),
        ]
      ),
      h.div(
        [h.Class("phone-actions")],
        [
          h.button(
            [
              h.Id("phone-calendars-button"),
              h.OnClick(Message.PhoneShellOpened({ mode: "drawer" })),
              h.AriaExpanded(model.phoneShell.mode === "drawer"),
              h.AriaControls("phone-shell-dialog"),
            ],
            ["Calendars"]
          ),
          h.button(
            [
              h.Id("command-menu-button"),
              h.OnClick(Message.KeyboardAction({ id: "commands" })),
              h.AriaLabel("Open command menu"),
            ],
            ["Commands"]
          ),
          h.button(
            [
              h.Id("phone-context-button"),
              h.OnClick(
                Message.PhoneShellOpened({
                  mode: selected ? "details" : "upcoming",
                })
              ),
              h.AriaControls("phone-shell-dialog"),
            ],
            [selected ? "Details" : "Upcoming"]
          ),
        ]
      ),
    ]
  );
};

export const phoneShellDialog = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  const { mode } = model.phoneShell;

  if (mode === "closed") {
    return [];
  }

  const content = Match.value(mode).pipe(
    Match.when("drawer", () => [sidebar(model, h)]),
    Match.when("details", () => detailPanel(model, h, "sheet")),
    Match.when("upcoming", () =>
      upcomingMeetingPanel(
        { ...model, calendar: { ...model.calendar, selected: [] } },
        h,
        "sheet"
      )
    ),
    Match.exhaustive
  );

  const title = Match.value(mode).pipe(
    Match.when("drawer", () => "Calendars"),
    Match.when("details", () => {
      if (model.calendar.selected.length > 1) {
        return `${model.calendar.selected.length} selected events`;
      }

      return (
        visibleEvents(model).find((event) => event.selected)?.title ??
        "Event details"
      );
    }),
    Match.when("upcoming", () => "Upcoming meeting"),
    Match.exhaustive
  );

  return [
    h.dialog(
      [
        h.Id("phone-shell-dialog"),
        h.Class("phone-shell-dialog"),
        h.DataAttribute("phone-shell-dialog", mode),
        h.AriaLabel(title),
      ],
      [
        h.header(
          [h.Class("phone-panel-header")],
          [
            h.h2([], [title]),
            h.button(
              [
                h.Class("phone-sheet-close"),
                h.AriaLabel("Close phone panel"),
                h.OnClick(Message.PhoneShellClosed()),
              ],
              ["×"]
            ),
          ]
        ),
        h.div([h.Class("phone-panel-content")], content),
      ]
    ),
  ];
};
