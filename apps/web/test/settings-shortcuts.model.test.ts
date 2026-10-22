import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import { resolveBinding } from "../src/client/keyboard/input.js";
import {
  keyboardRegistry,
  sequencePrefixes,
} from "../src/client/keyboard/registry.js";
import {
  sequenceKey,
  sequenceTimeout,
} from "../src/client/keyboard/sequence.js";
import { dayInZone, visibleDays } from "../src/layout/navigation.js";
import { SettingsRoute } from "../src/layout/route.js";
import { fixtureModel } from "./fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";

it.effect.prop(
  "all registered sequence prefixes resolve through the same timed machine",
  {
    gap: Schema.Int.check(Schema.isBetween({ maximum: 1200, minimum: 0 })),
  },
  ({ gap }) =>
    Effect.sync(() => {
      const base = keyboardFixture();

      const model = {
        ...base,
        calendar: {
          ...base.calendar,
          calendars: base.calendar.calendars.map((calendar) => ({
            ...calendar,
            allowedConferenceSolutionTypes: ["hangoutsMeet"],
          })),
        },
      };

      const startedPrefixes = new Map<
        string,
        ReturnType<typeof update>["model"]
      >();

      for (const binding of keyboardRegistry.flatMap((action) =>
        action.keys.filter((key) => key.includes(" "))
      )) {
        const [prefix = "", key = ""] = binding.split(" ");

        const first =
          startedPrefixes.get(prefix) ??
          update(
            model,
            Message.PressedCalendarKey({
              alt: false,
              key: prefix,
              mod: false,
              now: 100,
              shift: false,
            })
          ).model;

        startedPrefixes.set(prefix, first);
        expect(first.keyboard.prefix).toBe(prefix);

        const resolved = resolveBinding(
          first,
          { alt: false, key, mod: false, shift: false },
          100 + gap,
          "grid"
        );

        const expected = keyboardRegistry.find((row) =>
          row.keys.includes(binding)
        );

        if (gap < sequenceTimeout) {
          expect(resolved.action?.id).toBe(expected?.id);
        } else {
          expect(resolved.sequence.token).toBe(key);
        }

        expect(resolved.sequence.prefix).toBe("");
        expect(
          sequenceKey(
            first.keyboard,
            "unregistered-key",
            101,
            sequencePrefixes()
          ).token
        ).toBe(`${prefix} unregistered-key`);
      }
    })
);

it.effect(
  "G then S requests General without disturbing the calendar projection",
  () =>
    Effect.sync(() => {
      const base = keyboardFixture();

      const pending = update(
        base,
        Message.PressedCalendarKey({
          alt: false,
          key: "g",
          mod: false,
          now: 100,
          shift: false,
        })
      ).model;

      const result = update(
        pending,
        Message.PressedCalendarKey({
          alt: false,
          key: "s",
          mod: false,
          now: 101,
          shift: false,
        })
      );

      expect(result.model.route).toEqual(
        SettingsRoute.make({ page: "general" })
      );
      expect(result.model.calendar).toBe(base.calendar);
      expect(result.model.keyboard.prefix).toBe("");
    })
);

it.effect(
  "unknown prefix keys pass through and unregistered second keys cancel without action",
  () =>
    Effect.sync(() => {
      const base = fixtureModel();

      const nonPrefix = resolveBinding(
        base,
        { alt: false, key: "v", mod: false, shift: false },
        100,
        "grid"
      );

      expect(nonPrefix.prefix).toBe(false);
      expect(nonPrefix.sequence.token).toBe("v");
      expect(nonPrefix.action).toBeUndefined();

      const pending = update(
        base,
        Message.PressedCalendarKey({
          alt: false,
          key: "g",
          mod: false,
          now: 100,
          shift: false,
        })
      ).model;

      for (const key of ["v", "e", "g"]) {
        const cancelled = update(
          pending,
          Message.PressedCalendarKey({
            alt: false,
            key,
            mod: false,
            now: 101,
            shift: false,
          })
        );

        expect(cancelled.model.keyboard.prefix).toBe("");
        expect(cancelled.commands).toBeUndefined();
        expect(cancelled.model.calendar).toBe(base.calendar);
      }
    })
);

it.effect(
  "the existing T and Option-T entries swap their actions without adding another key path",
  () =>
    Effect.sync(() => {
      for (const todayAction of ["today", "align"] as const) {
        const base = fixtureModel();

        const model = {
          ...base,
          calendar: {
            ...base.calendar,
            navigation: {
              ...base.calendar.navigation,
              anchor: base.calendar.navigation.anchor + 14,
            },
          },
          settings: { ...base.settings, todayAction },
        };

        for (const alt of [false, true]) {
          const result = update(
            model,
            Message.PressedCalendarKey({
              alt,
              key: "t",
              mod: false,
              now: 100,
              shift: false,
            })
          );

          const align = todayAction === "align" ? !alt : alt;
          expect(result.model.calendar.navigation.mode).toBe(
            align ? "days" : "week"
          );
          expect(visibleDays(result.model.calendar.navigation)).toContain(
            dayInZone(base.calendar.now, base.calendar.zone)
          );
        }
      }
    })
);

it.effect(
  "theme cycling uses the registry and saves Auto, Light and Dark choices",
  () =>
    Effect.sync(() => {
      expect(
        keyboardRegistry.find((row) => row.id === "cycle-theme")?.keys
      ).toEqual(["Shift+Mod+l"]);
      let model = fixtureModel();

      for (const theme of ["light", "dark", "auto"]) {
        const result = update(
          model,
          Message.PressedCalendarKey({
            alt: false,
            key: "L",
            mod: true,
            now: 100,
            shift: true,
          })
        );

        ({ model } = result);
        expect(model.settings.theme).toBe(theme);
        expect(
          result.commands?.find((command) => command.name === "SavePreferences")
            ?.args?.theme
        ).toBe(theme);
      }
    })
);
