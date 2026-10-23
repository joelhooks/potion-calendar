import { expect, it } from "@effect/vitest";
import { Clock, Effect, Option, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { renderToString } from "foldkit/experimental/server";
import { afterEach, vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import {
  NotificationEvent,
  ReminderSnoozeRestore,
  ReminderSnoozeStorage,
} from "../src/client/reminders/model.js";
import { reminderSnoozeWakeStream } from "../src/client/reminders/snooze-clock.js";
import { SampleReminderSnoozeClock } from "../src/client/reminders/snooze-commands.js";
import { view } from "../src/features/app.js";
import { reminderCardScene } from "./reminder-card-fixture.js";

const documentFor = (model: AppModel) =>
  renderToString(
    { init: () => ({ model }), view },
    { isHydratable: false }
  ).pipe(
    Effect.map(({ html }) => new DOMParser().parseFromString(html, "text/html"))
  );

const storageCommands = (result: ReturnType<typeof update>) =>
  (result.commands ?? []).filter((command) =>
    [
      "PersistReminderSnooze",
      "RemoveReminderSnoozes",
      "RestoreReminderSnoozes",
    ].includes(command.name)
  );

afterEach(() => {
  vi.restoreAllMocks();
});

it.effect(
  "failed storage snoozes for a full sampled minute and fires once without reading, writing or retrying storage",
  () =>
    Effect.gen(function* sessionSnooze() {
      const base = reminderCardScene(
        "reminder",
        "light",
        900,
        "granted",
        "unavailable",
        "failed"
      ).model;

      const [card] = base.reminders.context.active;

      if (card === undefined) {
        return yield* Effect.die(new Error("Missing failed-storage reminder"));
      }

      const get = vi
        .spyOn(Storage.prototype, "getItem")
        .mockImplementation(() => {
          throw new Error("Blocked storage");
        });

      const set = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new Error("Blocked storage");
        });

      const remove = vi
        .spyOn(Storage.prototype, "removeItem")
        .mockImplementation(() => {
          throw new Error("Blocked storage");
        });

      yield* TestClock.setTime(base.calendar.now);
      yield* TestClock.adjust(59_000);
      const clickedAt = yield* Clock.currentTimeMillis;

      const requested = update(
        base,
        Message.RequestedReminderSnooze({
          choice: 1,
          id: card.id,
          personId: card.personId,
        })
      );

      const sample = SampleReminderSnoozeClock({
        choice: 1,
        id: card.id,
        identity: card.candidate.identity,
        personId: card.personId,
      });

      expect(
        requested.commands?.map((command) => ({
          args: command.args,
          name: command.name,
        }))
      ).toEqual([{ args: sample.args, name: sample.name }]);
      const samplingDocument = yield* documentFor(requested.model);
      expect(
        samplingDocument.querySelector(".reminder-snooze")?.textContent
      ).toContain("Snoozes won't be kept after a reload.");
      const accepted = update(requested.model, yield* sample.effect);

      const entry = {
        due: clickedAt + 60_000,
        identity: card.candidate.identity,
      };

      expect(accepted.model.reminders.context.snoozes).toEqual([entry]);
      expect(accepted.model.reminders.context.snoozeStorage).toEqual(
        ReminderSnoozeStorage.cases.Failed.make({})
      );
      expect(accepted.model.reminders.context.active).toEqual([]);
      expect(storageCommands(accepted)).toEqual([]);

      const emitted =
        yield* Queue.unbounded<ReturnType<typeof Message.Ticked>>();

      yield* reminderSnoozeWakeStream(Option.some(entry.due)).pipe(
        Stream.runForEach((message) => Queue.offer(emitted, message)),
        Effect.forkScoped
      );
      yield* TestClock.adjust(59_999);
      expect(yield* Queue.size(emitted)).toBe(0);
      yield* TestClock.adjust(1);
      const fired = update(accepted.model, yield* Queue.take(emitted));
      expect(fired.model.reminders.context.active).toHaveLength(1);
      expect(fired.model.reminders.context.active[0]?.card?.snoozedUntil).toBe(
        entry.due
      );
      expect(fired.model.reminders.context.snoozes).toEqual([]);
      expect(storageCommands(fired)).toEqual([]);

      const repeated = update(
        fired.model,
        Message.Ticked({ now: entry.due + 60_000 })
      );

      expect(repeated.model.reminders.context.active).toHaveLength(1);
      expect(storageCommands(repeated)).toEqual([]);
      expect(get).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "permission observation may clear the shared restore alert but cannot clear the storage-owned session-only note",
  () =>
    Effect.gen(function* persistentStorageNote() {
      const loading = reminderCardScene(
        "reminder",
        "light",
        900,
        "granted",
        "unavailable",
        "loading"
      ).model;

      const personId = Option.getOrThrow(loading.person);

      const failed = update(
        loading,
        Message.ReminderSnoozesRestored({
          outcome: ReminderSnoozeRestore.cases.Failed.make({}),
          personId,
        })
      ).model;

      expect(Option.isSome(failed.reminders.failure)).toBe(true);

      const observed = update(
        failed,
        Message.ObservedNotification({
          event: NotificationEvent.cases.Permission.make({
            permission: "granted",
            personId,
          }),
          now: failed.calendar.now,
        })
      ).model;

      expect(observed.reminders.failure).toEqual(Option.none());
      expect(observed.reminders.context.snoozeStorage).toEqual(
        ReminderSnoozeStorage.cases.Failed.make({})
      );
      const document = yield* documentFor(observed);
      const disclosure = document.querySelector(".reminder-snooze");
      expect(disclosure?.textContent).toContain(
        "Snoozes won't be kept after a reload."
      );
      expect(disclosure?.querySelectorAll("button")).toHaveLength(7);
      expect(disclosure?.querySelectorAll("button[disabled]")).toHaveLength(0);

      return yield* Effect.void;
    })
);

it.effect(
  "loading storage explains disabled Snooze choices and cannot dispatch a sampling or persistence command",
  () =>
    Effect.gen(function* loadingSnooze() {
      const { model } = reminderCardScene(
        "reminder",
        "light",
        900,
        "granted",
        "unavailable",
        "loading"
      );

      const [card] = model.reminders.context.active;

      if (card === undefined) {
        return yield* Effect.die(new Error("Missing loading-storage reminder"));
      }

      const document = yield* documentFor(model);
      const disclosure = document.querySelector(".reminder-snooze");
      expect(disclosure?.textContent).toContain("Loading snoozes…");
      expect(disclosure?.querySelectorAll("button[disabled]")).toHaveLength(7);

      const requested = update(
        model,
        Message.RequestedReminderSnooze({
          choice: 1,
          id: card.id,
          personId: card.personId,
        })
      );

      expect(requested.model).toBe(model);
      expect(requested.commands ?? []).toEqual([]);

      return yield* Effect.void;
    })
);
