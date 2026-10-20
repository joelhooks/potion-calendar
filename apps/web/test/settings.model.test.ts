import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { GestureResult } from "../src/client/editing/gesture-model.js";
import {
  SettingsChange,
  resolvedTheme,
  normalizePreferences,
} from "../src/client/settings/model.js";
import {
  defaultCreationCalendar,
  preferenceSnapshot,
} from "../src/client/settings/update.js";
import { partsFromDay, visibleDays } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { fixtureModel } from "./fixture.js";

it.effect.prop(
  "week start and weekend settings change actual rendered date columns",
  {
    start: Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 0 })),
    weekends: Schema.Boolean,
  },
  ({ start, weekends }) =>
    Effect.sync(() => {
      const initial = fixtureModel();

      const changed = update(
        initial,
        Message.ChangedSettings({
          change: SettingsChange.cases.WeekStart.make({ value: start }),
        })
      );

      expect(
        partsFromDay(visibleDays(changed.model.calendar.navigation)[0] ?? 0)
          .weekDay
      ).toBe(start);
      expect(
        changed.commands?.some((command) => command.name === "ReadEvents")
      ).toBe(true);

      const hidden = update(
        changed.model,
        Message.ChangedSettings({
          change: SettingsChange.cases.Weekends.make({ shown: weekends }),
        })
      );

      const days = visibleDays(hidden.model.calendar.navigation);
      expect(days).toHaveLength(weekends ? 7 : 5);

      if (!weekends) {
        expect(
          days.every((day) => ![0, 6].includes(partsFromDay(day).weekDay))
        ).toBe(true);
      }

      expect(
        hidden.commands?.find((command) => command.name === "SavePreferences")
          ?.args
      ).toMatchObject({
        hideWeekends: !weekends,
        version: 2,
        weekStartsOn: start,
      });
    })
);

it.effect(
  "every preference reaches the Model and one complete persistence command",
  () =>
    Effect.sync(() => {
      let model = fixtureModel();

      const changes = [
        SettingsChange.cases.Declined.make({ shown: false }),
        SettingsChange.cases.WeekNumbers.make({ shown: true }),
        SettingsChange.cases.TodayAction.make({ value: "align" }),
        SettingsChange.cases.TimeFormat.make({ value: "24" }),
        SettingsChange.cases.Theme.make({ value: "dark" }),
      ];

      for (const change of changes) {
        const result = update(model, Message.ChangedSettings({ change }));
        ({ model } = result);
        expect(
          result.commands?.filter(
            (command) => command.name === "SavePreferences"
          )
        ).toHaveLength(1);
        expect(
          result.commands?.find((command) => command.name === "SavePreferences")
            ?.args
        ).toMatchObject(preferenceSnapshot(model));
      }

      expect(model.settings).toMatchObject({
        showWeekNumbers: true,
        theme: "dark",
        timeFormat: "24",
        todayAction: "align",
      });
      expect(
        visibleEvents(model).some((event) => event.status === "declined")
      ).toBe(false);

      for (const message of [
        Message.ClickedCalendar({ accountId: "work", calendarId: "primary" }),
        Message.ClickedMergeDuplicates(),
        Message.ClickedDeclined(),
        Message.ClickedWeekends(),
      ]) {
        const result = update(model, message);
        expect(
          result.commands?.find((command) => command.name === "SavePreferences")
            ?.args
        ).toMatchObject({
          showWeekNumbers: true,
          theme: "dark",
          timeFormat: "24",
          todayAction: "align",
        });
      }
    })
);

it.effect(
  "a saved writable default drives Create and drag-create, with safe fallback after removal or permission loss",
  () =>
    Effect.sync(() => {
      const initial = fixtureModel();

      const destination = initial.calendar.calendars.find(
        (calendar) =>
          calendar.accountId !== "work" && calendar.accessRole === "owner"
      );

      expect(destination).toBeDefined();

      if (destination === undefined) {
        return;
      }

      const { model } = update(
        initial,
        Message.ChangedSettings({
          change: SettingsChange.cases.DefaultCalendar.make({
            value: Option.some(destination),
          }),
        })
      );

      expect(defaultCreationCalendar(model)).toEqual(destination);

      const created = update(
        model,
        Message.EditingAction({
          action: EditorAction.cases.OpenCreate.make({}),
        })
      );

      expect(
        created.commands?.find((command) => command.name === "DispatchEditing")
          ?.args?.command
      ).toMatchObject({
        request: {
          ref: {
            accountId: destination.accountId,
            calendarId: destination.calendarId,
          },
        },
      });

      const gesture = GestureResult.make({
        allDayRow: false,
        duplicate: false,
        id: 1,
        range: {
          allDay: false,
          endDate: "2026-10-19",
          endTime: "11:00",
          startDate: "2026-10-19",
          startTime: "10:00",
        },
        target: Option.none(),
      });

      const keyboardCreated = update(
        model,
        Message.PressedCalendarKey({
          alt: false,
          key: "c",
          mod: false,
          now: 100,
          shift: false,
        })
      );

      expect(
        keyboardCreated.commands?.find(
          (command) => command.name === "DispatchEditing"
        )?.args?.command
      ).toMatchObject({
        request: {
          ref: {
            accountId: destination.accountId,
            calendarId: destination.calendarId,
          },
        },
      });

      const dragged = update(
        model,
        Message.CompletedGesture({
          gesture,
          personId: Option.getOrThrow(model.person),
        })
      );

      expect(
        dragged.commands?.find((command) => command.name === "DispatchEditing")
          ?.args?.command
      ).toMatchObject({
        request: {
          ref: {
            accountId: destination.accountId,
            calendarId: destination.calendarId,
          },
        },
      });

      for (const calendars of [
        model.calendar.calendars.filter((calendar) => calendar !== destination),
        model.calendar.calendars.map((calendar) =>
          calendar === destination
            ? { ...calendar, accessRole: "reader" as const }
            : calendar
        ),
      ]) {
        expect(
          defaultCreationCalendar({
            ...model,
            calendar: { ...model.calendar, calendars },
          })
        ).not.toEqual(destination);
        expect(
          defaultCreationCalendar({
            ...model,
            calendar: { ...model.calendar, calendars },
          })?.accessRole
        ).toMatch(/owner|writer/u);
      }
    })
);

it.effect(
  "person changes clear saved settings but retain current system appearance and reject old-person reads",
  () =>
    Effect.sync(() => {
      const initial = fixtureModel();

      const media = update(
        initial,
        Message.ReceivedSystemSettings({ dark: true, hour24: true })
      ).model;

      expect(resolvedTheme(media)).toBe("dark");

      const stale = update(
        media,
        Message.ReceivedPreferences({
          person: "another-person",
          preferences: normalizePreferences({ hidden: [], theme: "light" }),
        })
      );

      expect(stale.model).toBe(media);

      const explicit = update(
        media,
        Message.ChangedSettings({
          change: SettingsChange.cases.Theme.make({ value: "light" }),
        })
      ).model;

      expect(
        resolvedTheme(
          update(
            explicit,
            Message.ReceivedSystemSettings({ dark: true, hour24: false })
          ).model
        )
      ).toBe("light");

      const signedOut = update(
        explicit,
        Message.ReceivedSession({ snapshot: null })
      ).model;

      expect(signedOut.settings.theme).toBe("auto");
      expect(signedOut.settings.systemDark).toBe(true);
      expect(Option.isNone(signedOut.settings.defaultCalendar)).toBe(true);
    })
);
