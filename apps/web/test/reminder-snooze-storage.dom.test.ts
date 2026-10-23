import { expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { afterEach, beforeEach, vi } from "vitest";

import {
  removeReminderSnoozes,
  restoreReminderSnoozes,
  saveReminderSnooze,
} from "../src/client/reminders/snooze-storage.js";
import { reminderEpoch } from "./reminders-fixture.js";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it.effect.each([1, 5, 15, 30, 60, 1440])(
  "a %s-minute choice persists only identity and absolute due and restores remaining time",
  (minutes) =>
    Effect.gen(function* persistChoice() {
      const entry = {
        due: reminderEpoch + minutes * 60_000,
        identity: "event-occurrence",
      };

      yield* saveReminderSnooze("person", entry);
      expect(localStorage.length).toBe(1);
      expect(
        JSON.parse(
          localStorage.getItem("calendar.reminder-snoozes.v1.person") ?? "null"
        )
      ).toEqual([entry]);
      expect(yield* restoreReminderSnoozes("person", entry.due - 1)).toEqual([
        entry,
      ]);
      expect(yield* restoreReminderSnoozes("person", entry.due)).toEqual([]);
      expect(localStorage.getItem("calendar.reminder-snoozes.v1.person")).toBe(
        "[]"
      );
    })
);

it.effect(
  "restore discards expired, malformed and payload-bearing rows without caching event data",
  () =>
    Effect.gen(function* pruneCache() {
      const entry = { due: reminderEpoch + 60_000, identity: "future" };

      localStorage.setItem(
        "calendar.reminder-snoozes.v1.person",
        JSON.stringify([
          { due: reminderEpoch - 1, identity: "expired" },
          { due: reminderEpoch, identity: "due-now" },
          { due: "5", identity: "string-duration" },
          { due: Number.MAX_VALUE, identity: "unrepresentable-date" },
          { ...entry, event: { title: "Must not be retained" } },
          entry,
        ])
      );
      expect(yield* restoreReminderSnoozes("person", reminderEpoch)).toEqual([
        entry,
      ]);
      expect(
        JSON.parse(
          localStorage.getItem("calendar.reminder-snoozes.v1.person") ?? "null"
        )
      ).toEqual([entry]);
    })
);

it.effect(
  "cache operations isolate people and stale cleanup cannot erase a replacement due time",
  () =>
    Effect.gen(function* isolateAndReplace() {
      const original = {
        due: reminderEpoch + 60_000,
        identity: "same-occurrence",
      };

      const replacement = { ...original, due: reminderEpoch + 300_000 };

      yield* saveReminderSnooze("first", original);
      yield* saveReminderSnooze("second", original);
      yield* saveReminderSnooze("first", replacement);
      yield* removeReminderSnoozes("first", [original]);
      expect(yield* restoreReminderSnoozes("first", reminderEpoch)).toEqual([
        replacement,
      ]);
      expect(yield* restoreReminderSnoozes("second", reminderEpoch)).toEqual([
        original,
      ]);
      yield* removeReminderSnoozes("first", [replacement]);
      expect(yield* restoreReminderSnoozes("first", reminderEpoch)).toEqual([]);
      expect(yield* restoreReminderSnoozes("second", reminderEpoch)).toEqual([
        original,
      ]);
    })
);

it.effect(
  "a malformed cache document reports failure rather than pretending it restored no snoozes",
  () =>
    Effect.gen(function* malformedDocument() {
      localStorage.setItem("calendar.reminder-snoozes.v1.person", "not-json");

      const result = yield* Effect.exit(
        restoreReminderSnoozes("person", reminderEpoch)
      );

      expect(Exit.isFailure(result)).toBe(true);
      expect(localStorage.getItem("calendar.reminder-snoozes.v1.person")).toBe(
        "not-json"
      );
    })
);

it.effect(
  "an unavailable durable write fails without claiming that a choice was cached",
  () =>
    Effect.gen(function* blockedStorage() {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("Storage unavailable");
      });

      const result = yield* Effect.exit(
        saveReminderSnooze("person", {
          due: reminderEpoch + 60_000,
          identity: "event",
        })
      );

      expect(Exit.isFailure(result)).toBe(true);
      expect(localStorage.length).toBe(0);
    })
);
