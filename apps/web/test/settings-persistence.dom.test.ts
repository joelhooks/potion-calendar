import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import { calendarKey } from "../src/client/calendar-state.js";
import { ReadPreferences, SavePreferences } from "../src/client/commands.js";
import { normalizePreferences } from "../src/client/settings/model.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import {
  displayZone,
  initialZonePreferences,
} from "../src/layout/time-zones.js";
import { fixtureModel } from "./fixture.js";

const fail = () => {
  throw new Error("storage unavailable");
};

it.effect(
  "the complete versioned preference record reloads through the real per-person storage commands",
  () =>
    Effect.gen(function* reloadPreferences() {
      localStorage.clear();

      const preferences = normalizePreferences({
        defaultCalendar: { accountId: "personal", calendarId: "primary" },
        hideDeclined: true,
        hideWeekends: true,
        mergeDuplicates: false,
        showWeekNumbers: true,
        theme: "dark",
        timeFormat: "24",
        todayAction: "align",
        version: 2,
        visibility: { [calendarKey("work", "primary")]: false },
        weekStartsOn: 1,
        zones: {
          ...initialZonePreferences("America/Los_Angeles"),
          secondary: [displayZone("Asia/Tokyo", "Team")],
        },
      });

      yield* SavePreferences({ ...preferences, person: "settings-one" }).effect;
      const base = { ...fixtureModel(), person: Option.some("settings-one") };

      const loaded = update(
        base,
        yield* ReadPreferences({ person: "settings-one" }).effect
      ).model;

      expect(preferenceSnapshot(loaded)).toEqual(preferences);
      expect(yield* ReadPreferences({ person: "settings-two" }).effect).toEqual(
        Message.ReceivedPreferences({
          person: "settings-two",
          preferences: normalizePreferences({ version: 2, visibility: {} }),
        })
      );
      localStorage.clear();
    })
);

it.effect(
  "blocked reads and writes return distinct honest failures, never a saved acknowledgement",
  () =>
    Effect.gen(function* blockedPreferences() {
      const read = vi
        .spyOn(Storage.prototype, "getItem")
        .mockImplementation(fail);

      const write = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(fail);

      yield* Effect.gen(function* verifyFailures() {
        const base = fixtureModel();
        const person = Option.getOrThrow(base.person);
        const readFailure = yield* ReadPreferences({ person }).effect;

        const writeFailure = yield* SavePreferences({
          ...normalizePreferences({ hidden: [] }),
          person,
        }).effect;

        expect(readFailure).toEqual(Message.FailedPreferences({ person }));
        expect(writeFailure).toEqual(Message.FailedPreferenceSave({ person }));
        expect(
          Option.getOrUndefined(update(base, readFailure).model.error)
        ).toMatch(/default/iu);
        expect(
          Option.getOrUndefined(update(base, writeFailure).model.error)
        ).toMatch(/not.*saved/iu);
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            read.mockRestore();
            write.mockRestore();
          })
        )
      );
    })
);
