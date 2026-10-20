import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { Message, update } from "../src/client/app.js";
import { commandChoices } from "../src/client/keyboard/choices.js";
import { TimeZoneAction, ZoneChooser } from "../src/client/time-zones/model.js";
import {
  applyZonePreferences,
  changeTimeZones,
} from "../src/client/time-zones/update.js";
import { midnightInZone, visibleDays } from "../src/layout/navigation.js";
import { displayZone } from "../src/layout/time-zones.js";
import { fixtureSelection } from "./fixture.js";

it.effect(
  "Z and Escape use registry dispatch, preserve home and selection, and reread the active-zone range",
  () =>
    Effect.sync(() => {
      const base = fixtureSelection();

      const opened = update(
        base,
        Message.PressedCalendarKey({
          alt: false,
          key: "z",
          mod: false,
          now: 100,
          shift: false,
        })
      );

      expect(opened.model.keyboard.screen).toBe("zones");

      const travelled = update(
        opened.model,
        Message.TimeZoneAction({
          action: TimeZoneAction.cases.Travel.make({
            zone: displayZone("Asia/Tokyo"),
          }),
        })
      );

      expect(travelled.model.calendar.zone).toBe("Asia/Tokyo");
      expect(travelled.model.timeZones.preferences.primary).toEqual(
        base.timeZones.preferences.primary
      );
      expect(travelled.model.calendar.selected).toEqual(base.calendar.selected);
      const days = visibleDays(base.calendar.navigation);
      expect(
        travelled.commands
          ?.filter((command) => command.name === "ReadEvents")
          .map((command) => command.args?.range)
      ).toEqual(
        ["work", "personal"].map(() => ({
          end: midnightInZone((days.at(-1) ?? 0) + 1, "Asia/Tokyo"),
          start: midnightInZone(days[0] ?? 0, "Asia/Tokyo"),
        }))
      );
      expect(
        travelled.commands?.find(
          (command) => command.name === "SavePreferences"
        )?.args?.zones
      ).toEqual(travelled.model.timeZones.preferences);

      const home = update(
        travelled.model,
        Message.PressedCalendarKey({
          alt: false,
          key: "Escape",
          mod: false,
          now: 200,
          shift: false,
        })
      );

      expect(home.model.calendar.zone).toBe(base.calendar.zone);
      expect(home.model.calendar.navigation).toEqual(base.calendar.navigation);
      expect(home.model.calendar.selected).toEqual(base.calendar.selected);
      expect(Option.isNone(home.model.timeZones.temporary)).toBe(true);
    })
);

it.effect(
  "zone-only changes invalidate command choices even when the calendar and keyboard objects are unchanged",
  () =>
    Effect.sync(() => {
      const base = fixtureSelection();
      const first = commandChoices(base);
      expect(first.some((entry) => entry.id === "hide-zone")).toBe(false);

      const next = {
        ...base,
        timeZones: changeTimeZones(
          base.timeZones,
          TimeZoneAction.cases.Add.make({ zone: displayZone("Asia/Tokyo") })
        ),
      };

      expect(next.calendar).toBe(base.calendar);
      expect(next.keyboard).toBe(base.keyboard);
      const choices = commandChoices(next);
      expect(choices).not.toBe(first);
      expect(choices.some((entry) => entry.id === "hide-zone")).toBe(true);
      expect(commandChoices(next)).toBe(choices);
    })
);

it.effect(
  "system prompting defaults On, never changes home silently, and only a newly observed non-home zone prompts",
  () =>
    Effect.sync(() => {
      const base = fixtureSelection().timeZones;
      const observed = { ...base, system: "Asia/Tokyo" };
      expect(base.preferences.askToChange).toBe(true);
      expect(
        Option.isNone(applyZonePreferences(base, base.preferences).systemPrompt)
      ).toBe(true);

      const off = applyZonePreferences(observed, {
        ...base.preferences,
        askToChange: false,
      });

      expect(Option.isNone(off.systemPrompt)).toBe(true);
      expect(off.preferences.primary.id).toBe(base.preferences.primary.id);

      const prompted = applyZonePreferences(observed, {
        ...base.preferences,
        askToChange: true,
      });

      expect(Option.getOrUndefined(prompted.systemPrompt)).toBe("Asia/Tokyo");
      expect(
        Option.isNone(
          applyZonePreferences(observed, prompted.preferences).systemPrompt
        )
      ).toBe(true);
      expect(
        Option.isNone(
          applyZonePreferences(
            { ...observed, system: base.preferences.primary.id },
            prompted.preferences
          ).systemPrompt
        )
      ).toBe(true);

      const dismissed = changeTimeZones(
        prompted,
        TimeZoneAction.cases.DismissSystem.make({})
      );

      expect(dismissed.preferences.primary.id).toBe(
        base.preferences.primary.id
      );
      expect(Option.isNone(dismissed.systemPrompt)).toBe(true);

      const accepted = changeTimeZones(
        prompted,
        TimeZoneAction.cases.AcceptSystem.make({})
      );

      expect(accepted.preferences.primary.id).toBe("Asia/Tokyo");
      expect(Option.isNone(accepted.systemPrompt)).toBe(true);
    })
);

it.effect(
  "chooser results exclude displayed zones and change after adding a secondary without a calendar change",
  () =>
    Effect.sync(() => {
      const base = fixtureSelection();

      const zones = changeTimeZones(
        base.timeZones,
        TimeZoneAction.cases.Open.make({
          chooser: ZoneChooser.cases.Add.make({}),
        })
      );

      const first = {
        ...base,
        keyboard: {
          ...base.keyboard,
          query: "Tokyo",
          screen: "zones" as const,
        },
        timeZones: zones,
      };

      expect(
        commandChoices(first).some((entry) => entry.id === "Asia/Tokyo")
      ).toBe(true);

      const next = {
        ...first,
        timeZones: changeTimeZones(
          zones,
          TimeZoneAction.cases.Add.make({ zone: displayZone("Asia/Tokyo") })
        ),
      };

      expect(
        commandChoices(next).some((entry) => entry.id === "Asia/Tokyo")
      ).toBe(false);
    })
);
