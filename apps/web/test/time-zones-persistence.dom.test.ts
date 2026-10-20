import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { initialModel, update } from "../src/client/app.js";
import { ReadPreferences, SavePreferences } from "../src/client/commands.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import { fixtureSelection } from "./fixture.js";

it.effect(
  "a valid legacy read saves the first home once, and a later system-zone change cannot redefine it",
  () =>
    Effect.gen(function* firstHome() {
      localStorage.clear();
      const base = fixtureSelection();
      const person = Option.getOrThrow(base.person);
      const legacy = yield* ReadPreferences({ person }).effect;
      const first = update(base, legacy);
      const snapshot = preferenceSnapshot(first.model);
      expect(
        first.commands?.find((command) => command.name === "SavePreferences")
          ?.args
      ).toEqual({ ...snapshot, person });
      expect(snapshot.zones?.primary.id).toBe(base.calendar.zone);
      expect(snapshot.zones?.askToChange).toBe(true);
      expect(Option.isNone(first.model.timeZones.systemPrompt)).toBe(true);
      yield* SavePreferences({ ...snapshot, person }).effect;

      const otherSystem = {
        ...initialModel(base.calendar.now, "Asia/Tokyo"),
        person: Option.some(person),
      };

      const restored = update(
        otherSystem,
        yield* ReadPreferences({ person }).effect
      );

      expect(restored.model.calendar.zone).toBe(base.calendar.zone);
      expect(restored.model.timeZones.system).toBe("Asia/Tokyo");
      expect(Option.getOrUndefined(restored.model.timeZones.systemPrompt)).toBe(
        "Asia/Tokyo"
      );
      expect(
        restored.commands?.find((command) => command.name === "SavePreferences")
          ?.args
      ).toMatchObject({
        zones: {
          lastSystemZone: "Asia/Tokyo",
          primary: { id: base.calendar.zone },
        },
      });
      yield* SavePreferences({ ...preferenceSnapshot(restored.model), person })
        .effect;

      const repeated = update(
        otherSystem,
        yield* ReadPreferences({ person }).effect
      );

      expect(repeated.model.calendar.zone).toBe(base.calendar.zone);
      expect(Option.isNone(repeated.model.timeZones.systemPrompt)).toBe(true);
      expect(
        repeated.commands?.some((command) => command.name === "SavePreferences")
      ).toBe(false);
      yield* SavePreferences({
        ...preferenceSnapshot(repeated.model),
        person,
        zones: { ...repeated.model.timeZones.preferences, askToChange: false },
      }).effect;

      const nextSystem = {
        ...initialModel(base.calendar.now, "Europe/London"),
        person: Option.some(person),
      };

      const disabled = update(
        nextSystem,
        yield* ReadPreferences({ person }).effect
      ).model;

      expect(disabled.calendar.zone).toBe(base.calendar.zone);
      expect(disabled.timeZones.preferences.askToChange).toBe(false);
      expect(Option.isNone(disabled.timeZones.systemPrompt)).toBe(true);
      localStorage.clear();
    })
);
