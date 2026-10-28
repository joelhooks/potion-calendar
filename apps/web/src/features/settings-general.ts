import { Match, Option, Schema } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";
import { browserMapsPlatform } from "../client/settings/maps-platform.js";
import {
  SettingsChange,
  Theme,
  TimeFormat,
  TodayAction,
  UpcomingMeetingMinutes,
  WeekStart,
} from "../client/settings/model.js";
import { orderedWeekdays } from "../client/settings/weekday-choices.js";
import { TimeZoneAction } from "../client/time-zones/model.js";
import {
  AppLanguage,
  deskDefaultBrowserLanguageLabel,
  deskDefaultUiCopyLocale,
  languageChoice,
  resolvedAppLocale,
} from "../layout/app-locale.js";
import { LocationMaps } from "../layout/location-maps.js";
import { hiddenTimeWeekdays } from "../layout/navigation.js";
import { persistentZones, zoneLabel } from "../layout/time-zones.js";
import { desktopSettingsView } from "./desktop-settings-actions.js";
import { desktopGeneralRows } from "./desktop-settings.js";
import { settingsTimeBlocks } from "./settings-time-blocks.js";

const choice = <A extends string | number>(
  h: HtmlBuilder<AppMessage>,
  id: string,
  label: string,
  value: A,
  options: readonly (readonly [A, string])[],
  decode: (value: string) => Option.Option<typeof SettingsChange.Type>
): Html =>
  h.label(
    [h.Class("settings-row"), h.For(id)],
    [
      h.span([], [label]),
      h.select(
        [
          h.Id(id),
          h.Value(String(value)),
          h.OnChange((raw) =>
            Option.match(decode(raw), {
              onNone: () => Message.SavedPreferences(),
              onSome: (change) => Message.ChangedSettings({ change }),
            })
          ),
        ],
        options.map(([key, text]) =>
          h.option([h.Value(String(key)), h.Selected(key === value)], [text])
        )
      ),
    ]
  );

const upcomingHorizonLabel = (
  minutes: typeof UpcomingMeetingMinutes.Type
): string =>
  Match.value(minutes).pipe(
    Match.when(10_080, () => "Always"),
    Match.when(30, () => "30 minutes before"),
    Match.orElse(
      (value) => `${value / 60} ${value === 60 ? "hour" : "hours"} before`
    )
  );

const visibleWeekdaySetting = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): Html =>
  h.div(
    [h.Class("settings-row")],
    [
      h.span([], ["Visible weekdays"]),
      h.div(
        [h.Class("settings-weekday-control")],
        [
          h.div(
            [h.Class("settings-weekdays")],
            orderedWeekdays(
              model.calendar.navigation.weekStartsOn ?? 0,
              resolvedAppLocale(model)
            ).map(({ name, value }) =>
              h.label(
                [],
                [
                  h.input([
                    h.Type("checkbox"),
                    h.AriaLabel(`Show ${name}`),
                    h.Checked(
                      !hiddenTimeWeekdays(model.calendar.navigation).includes(
                        value
                      )
                    ),
                    h.OnClick(
                      Message.ChangedSettings({
                        change: SettingsChange.cases.Weekday.make({
                          shown: hiddenTimeWeekdays(
                            model.calendar.navigation
                          ).includes(value),
                          value,
                        }),
                      })
                    ),
                  ]),
                  name.slice(0, 3),
                ]
              )
            )
          ),
          h.p(
            [h.Class("muted")],
            ["Custom hidden weekdays affect time views, not Month."]
          ),
        ]
      ),
    ]
  );

export const settingsGeneral = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  const booleanChoice = (
    id: string,
    label: string,
    shown: boolean,
    make: (shown: boolean) => typeof SettingsChange.Type
  ) =>
    choice(
      h,
      id,
      label,
      shown ? "shown" : "hidden",
      [
        ["shown", "Shown"],
        ["hidden", "Hidden"],
      ],
      (value) =>
        Option.map(
          Schema.decodeUnknownOption(Schema.Literals(["shown", "hidden"]))(
            value
          ),
          (parsed) => make(parsed === "shown")
        )
    );

  return [
    h.h1([], ["General"]),
    ...desktopSettingsView(model.desktop, h, desktopGeneralRows),
    settingsTimeBlocks(model, h),
    h.section(
      [h.Class("settings-section")],
      [
        h.h2([], ["Calendar view"]),
        booleanChoice(
          "settings-weekends",
          "Weekends",
          !model.calendar.navigation.hideWeekends,
          (shown) => SettingsChange.cases.Weekends.make({ shown })
        ),
        visibleWeekdaySetting(model, h),
        booleanChoice(
          "settings-declined",
          "Declined events",
          !model.calendar.hideDeclined,
          (shown) => SettingsChange.cases.Declined.make({ shown })
        ),
        booleanChoice(
          "settings-week-numbers",
          "Week numbers",
          model.settings.showWeekNumbers,
          (shown) => SettingsChange.cases.WeekNumbers.make({ shown })
        ),
        choice(
          h,
          "settings-week-start",
          "Start week on",
          model.calendar.navigation.weekStartsOn ?? 0,
          orderedWeekdays(0, resolvedAppLocale(model)).map(
            ({ name, value }) => [value, name]
          ),
          (raw) =>
            Option.map(Schema.decodeOption(WeekStart)(Number(raw)), (value) =>
              SettingsChange.cases.WeekStart.make({ value })
            )
        ),
        h.div(
          [h.Class("settings-row")],
          [
            h.span([], ["Displayed view"]),
            h.span(
              [],
              [
                `${Match.value(model.calendar.navigation.mode).pipe(
                  Match.when("week", () => "Week · 7 days"),
                  Match.when("day", () => "Day · 1 day"),
                  Match.when(
                    "days",
                    () => `${model.calendar.navigation.days} days`
                  ),
                  Match.when("month", () => "Month"),
                  Match.exhaustive
                )}. Change this on the calendar.`,
              ]
            ),
          ]
        ),
      ]
    ),
    h.section(
      [h.Class("settings-section")],
      [
        h.h2([], ["Calendar navigation"]),
        choice(
          h,
          "settings-today",
          "Press T to",
          model.settings.todayAction,
          [
            ["today", "Go to today"],
            ["align", "Align today in view"],
          ],
          (raw) =>
            Option.map(Schema.decodeUnknownOption(TodayAction)(raw), (value) =>
              SettingsChange.cases.TodayAction.make({ value })
            )
        ),
        h.p([h.Class("muted")], ["Option-T takes the other action."]),
      ]
    ),
    h.section(
      [h.Class("settings-section")],
      [
        h.h2([], ["Meetings"]),
        choice(
          h,
          "settings-upcoming-meeting",
          "Show upcoming meeting in context panel",
          model.settings.upcomingMeetingMinutes,
          UpcomingMeetingMinutes.literals.map(
            (
              minutes
            ): readonly [typeof UpcomingMeetingMinutes.Type, string] => [
              minutes,
              upcomingHorizonLabel(minutes),
            ]
          ),
          (raw) =>
            Schema.decodeUnknownOption(UpcomingMeetingMinutes)(
              Number(raw)
            ).pipe(
              Option.map((minutes) =>
                SettingsChange.cases.UpcomingMeeting.make({ minutes })
              )
            )
        ),
      ]
    ),
    h.section(
      [h.Class("settings-section")],
      [
        h.h2([], ["Appearance"]),
        choice(
          h,
          "settings-language",
          "Language",
          model.settings.language ?? "browser",
          [
            ["browser", deskDefaultBrowserLanguageLabel],
            ...AppLanguage.literals.map(
              (locale): readonly [typeof AppLanguage.Type, string] => [
                locale,
                `${locale} · ${new Intl.DisplayNames(deskDefaultUiCopyLocale, { type: "language" }).of(locale) ?? locale}`,
              ]
            ),
          ],
          (raw) =>
            Option.map(languageChoice(raw), (value) =>
              SettingsChange.cases.Language.make({ value })
            )
        ),
        choice(
          h,
          "settings-clock",
          "Time format",
          model.settings.timeFormat,
          [
            ["system", "System"],
            ["12", "12-hour time"],
            ["24", "24-hour time"],
          ],
          (raw) =>
            Option.map(Schema.decodeUnknownOption(TimeFormat)(raw), (value) =>
              SettingsChange.cases.TimeFormat.make({ value })
            )
        ),
        choice(
          h,
          "settings-theme",
          "Theme",
          model.settings.theme,
          [
            ["auto", "Auto"],
            ["light", "Light"],
            ["dark", "Dark"],
          ],
          (raw) =>
            Option.map(Schema.decodeUnknownOption(Theme)(raw), (value) =>
              SettingsChange.cases.Theme.make({ value })
            )
        ),
        h.div(
          [h.Class("settings-row")],
          [
            h.span([], ["Time zone"]),
            h.span(
              [],
              [
                `${persistentZones(model.timeZones.preferences)
                  .map((zone) => `${zoneLabel(zone)} (${zone.id})`)
                  .join(
                    " · "
                  )}. Change these on the calendar using Z or the zone headers.`,
              ]
            ),
          ]
        ),
        h.label(
          [h.Class("settings-row"), h.For("settings-ask-zone")],
          [
            h.span([], ["Ask to change time zone to new locations"]),
            h.select(
              [
                h.Id("settings-ask-zone"),
                h.Value(model.timeZones.preferences.askToChange ? "on" : "off"),
                h.OnChange((raw) =>
                  Schema.decodeUnknownOption(Schema.Literals(["on", "off"]))(
                    raw
                  ).pipe(
                    Option.match({
                      onNone: () => Message.SavedPreferences(),
                      onSome: (value) =>
                        Message.TimeZoneAction({
                          action: TimeZoneAction.cases.AskToChange.make({
                            enabled: value === "on",
                          }),
                        }),
                    })
                  )
                ),
              ],
              [
                h.option(
                  [
                    h.Value("off"),
                    h.Selected(!model.timeZones.preferences.askToChange),
                  ],
                  ["Off"]
                ),
                h.option(
                  [
                    h.Value("on"),
                    h.Selected(model.timeZones.preferences.askToChange),
                  ],
                  ["On"]
                ),
              ]
            ),
          ]
        ),
      ]
    ),
    ...(browserMapsPlatform().apple
      ? [
          h.section(
            [h.Class("settings-section"), h.Id("settings-location")],
            [
              h.h2([], ["Location"]),
              choice(
                h,
                "settings-location-maps",
                "Open location links in",
                model.settings.locationMaps,
                [
                  ["google", "Google Maps"],
                  ["apple", "Apple Maps"],
                ],
                (raw) =>
                  Option.map(
                    Schema.decodeUnknownOption(LocationMaps)(raw),
                    (value) => SettingsChange.cases.LocationMaps.make({ value })
                  )
              ),
            ]
          ),
        ]
      : []),
    h.p(
      [h.Class("settings-device-note")],
      [
        "Settings are saved for this person on this device. Browser and desktop settings do not sync.",
      ]
    ),
  ];
};
