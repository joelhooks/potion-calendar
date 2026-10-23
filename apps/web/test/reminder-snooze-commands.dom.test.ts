import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Match, Option } from "effect";
import { TestClock } from "effect/testing";
import { AsyncData } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";
import { afterEach, beforeEach, vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { CloseReminderNotifications } from "../src/client/reminders/commands.js";
import { ReminderSnoozeStorage } from "../src/client/reminders/model.js";
import type {
  NotificationContentValue,
  ReminderSnoozeChoice,
} from "../src/client/reminders/model.js";
import {
  PersistReminderSnooze,
  RestoreReminderSnoozes,
  SampleReminderSnoozeClock,
} from "../src/client/reminders/snooze-commands.js";
import { reminderCards } from "../src/features/reminder-cards.js";
import { reminderCardScene } from "./reminder-card-fixture.js";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const readyReminder = Effect.fn("readySnoozeReminder")(function* readyReminder(
  width: number
) {
  const base = reminderCardScene("reminder", "light", width).model;
  const [notification] = base.reminders.context.active;

  if (notification === undefined) {
    return yield* Effect.die(new Error("Missing reminder card"));
  }

  yield* TestClock.setTime(base.calendar.now);

  const receipt = yield* RestoreReminderSnoozes({
    personId: notification.personId,
  }).effect;

  const restored = update(base, receipt).model;
  const { model } = update(restored, Message.MeasuredShellViewport({ width }));

  return { model, notification };
});

const sampleChoice = Effect.fn("sampleSnoozeChoice")(function* sampleChoice(
  notification: NotificationContentValue,
  choice: typeof ReminderSnoozeChoice.Type
) {
  const sample = SampleReminderSnoozeClock({
    choice,
    id: notification.id,
    identity: notification.candidate.identity,
    personId: notification.personId,
  });

  const sampled = yield* sample.effect;

  return { sample, sampled };
});

const cardsView = (model: AppModel, h: HtmlBuilder<AppMessage>) => ({
  body: h.div([], reminderCards(model, h)),
  title: "Snooze reminder",
});

it.effect.each([1, 5, 15, 30, 60, 1440, "start"] as const)(
  "the actual %s choice dispatches the durable command and closes only after its successful acknowledgement",
  (choice) =>
    Effect.gen(function* actualChoice() {
      const { model, notification } = yield* readyReminder(1440);

      const entry = {
        due:
          choice === "start"
            ? notification.candidate.start
            : model.calendar.now + choice * 60_000,
        identity: notification.candidate.identity,
      };

      const command = PersistReminderSnooze({
        entry,
        id: notification.id,
        personId: notification.personId,
      });

      const { sample, sampled } = yield* sampleChoice(notification, choice);
      const receipt = yield* command.effect;

      const requested = update(
        model,
        Message.RequestedReminderSnooze({
          choice,
          id: notification.id,
          personId: notification.personId,
        })
      ).model;

      expect(requested.reminders.context.active).toHaveLength(1);
      expect(requested.reminders.context.snoozeStorage).toMatchObject(
        ReminderSnoozeStorage.cases.Sampling.make({
          choice,
          id: notification.id,
          identity: notification.candidate.identity,
          persistence: "durable",
        })
      );
      const prepared = update(requested, sampled).model;

      expect(prepared.reminders.context.snoozeStorage).toMatchObject(
        ReminderSnoozeStorage.cases.Saving.make({ entry, id: notification.id })
      );
      expect(update(prepared, receipt).model.reminders.context.snoozes).toEqual(
        [entry]
      );

      const label = Match.value(choice).pipe(
        Match.when("start", () => "Until start"),
        Match.when(1, () => "1 minute"),
        Match.orElse((minutes) => `${minutes} minutes`)
      );

      Scene.scene(
        { update, view: cardsView },
        Scene.given(model),
        Scene.click(Scene.role("button", { name: label })),
        Scene.Command.expectHas(sample),
        Scene.Command.resolve(sample, sampled),
        Scene.Command.expectHas(command),
        Scene.Command.resolve(command, receipt),
        Scene.Command.resolve(
          CloseReminderNotifications,
          Message.ReminderEffectCompleted()
        ),
        Scene.expect(Scene.selector(".reminder-card")).toBeAbsent()
      );
      expect(
        localStorage.getItem(
          `calendar.reminder-snoozes.v1.${notification.personId}`
        )
      ).toBe(JSON.stringify([entry]));
    })
);

it.effect(
  "the phone card's five-minute button uses the same durable action and owner",
  () =>
    Effect.gen(function* phoneChoice() {
      const { model, notification } = yield* readyReminder(390);

      const entry = {
        due: model.calendar.now + 300_000,
        identity: notification.candidate.identity,
      };

      const command = PersistReminderSnooze({
        entry,
        id: notification.id,
        personId: notification.personId,
      });

      const { sample, sampled } = yield* sampleChoice(notification, 5);
      const receipt = yield* command.effect;

      Scene.scene(
        { update, view: cardsView },
        Scene.given(model),
        Scene.click(Scene.role("button", { name: "5 minutes" })),
        Scene.Command.expectHas(sample),
        Scene.Command.resolve(sample, sampled),
        Scene.Command.expectHas(command),
        Scene.Command.resolve(command, receipt),
        Scene.Command.resolve(
          CloseReminderNotifications,
          Message.ReminderEffectCompleted()
        ),
        Scene.expect(Scene.selector(".reminder-card")).toBeAbsent()
      );
    })
);

it.effect(
  "a failed durable acknowledgement keeps the card and exposes a retryable failure",
  () =>
    Effect.gen(function* failedChoice() {
      const { model, notification } = yield* readyReminder(1440);

      const entry = {
        due: model.calendar.now + 300_000,
        identity: notification.candidate.identity,
      };

      const command = PersistReminderSnooze({
        entry,
        id: notification.id,
        personId: notification.personId,
      });

      const { sample, sampled } = yield* sampleChoice(notification, 5);

      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("Storage blocked");
      });

      const receipt = yield* command.effect;

      const requested = update(
        model,
        Message.RequestedReminderSnooze({
          choice: 5,
          id: notification.id,
          personId: notification.personId,
        })
      ).model;

      const prepared = update(requested, sampled).model;
      const failed = update(prepared, receipt).model;

      expect(failed.reminders.context.snoozes).toEqual([]);
      expect(failed.reminders.context.snoozeStorage).toMatchObject(
        ReminderSnoozeStorage.cases.Ready.make({})
      );

      Scene.scene(
        { update, view: cardsView },
        Scene.given(model),
        Scene.click(Scene.role("button", { name: "5 minutes" })),
        Scene.Command.expectHas(sample),
        Scene.Command.resolve(sample, sampled),
        Scene.Command.expectHas(command),
        Scene.Command.resolve(command, receipt),
        Scene.expect(Scene.selector(".reminder-card")).toExist(),
        Scene.expect(Scene.role("alert")).toHaveText(
          "This reminder could not be snoozed. Try again."
        )
      );
    })
);

it.effect(
  "stale choices and receipts cannot snooze a different card or person, and Until start refuses a late action",
  () =>
    Effect.gen(function* staleActions() {
      const { model, notification } = yield* readyReminder(1440);

      const sampling = update(
        model,
        Message.RequestedReminderSnooze({
          choice: 5,
          id: notification.id,
          personId: notification.personId,
        })
      );

      const entry = {
        due: model.calendar.now + 300_000,
        identity: notification.candidate.identity,
      };

      const { sampled } = yield* sampleChoice(notification, 5);
      const requested = update(sampling.model, sampled);

      for (const changed of [
        {
          entry,
          failed: false,
          id: "other-card",
          personId: notification.personId,
        },
        { entry, failed: false, id: notification.id, personId: "other-person" },
        {
          entry: { ...entry, due: entry.due + 1 },
          failed: false,
          id: notification.id,
          personId: notification.personId,
        },
      ]) {
        const ignored = update(
          requested.model,
          Message.ReminderSnoozeSaved(changed)
        );

        expect(ignored.model.reminders.context).toEqual(
          requested.model.reminders.context
        );
        expect(ignored.commands ?? []).toEqual([]);
      }

      const busyDismiss = update(
        requested.model,
        Message.ReminderCardAction({
          action: "dismiss",
          id: notification.id,
          personId: notification.personId,
        })
      );

      expect(busyDismiss.model.reminders.context.active).toHaveLength(1);
      expect(busyDismiss.commands ?? []).toEqual([]);

      const late = update(
        model,
        Message.Ticked({ now: notification.candidate.start })
      ).model;

      const lateSampling = update(
        late,
        Message.RequestedReminderSnooze({
          choice: "start",
          id: notification.id,
          personId: notification.personId,
        })
      );

      yield* TestClock.setTime(notification.candidate.start + 1);
      const lateClock = yield* sampleChoice(notification, "start");
      const rejected = update(lateSampling.model, lateClock.sampled);

      expect(rejected.commands ?? []).toEqual([]);
      expect(rejected.model.reminders.context.snoozes).toEqual([]);
    })
);

it.effect(
  "restoring a future past-event snooze widens only the existing read and waits for accepted coverage before dropping unresolved entries",
  () =>
    Effect.gen(function* restorePastEvent() {
      const original = yield* readyReminder(1440);

      const entry = {
        due: original.model.calendar.now + 3_600_000,
        identity: original.notification.candidate.identity,
      };

      yield* PersistReminderSnooze({
        entry,
        id: original.notification.id,
        personId: original.notification.personId,
      }).effect;

      const { model: fresh } = reminderCardScene(
        "reminder",
        "light",
        1440,
        "granted",
        "unavailable",
        "loading"
      );

      const saved = Option.getOrThrow(AsyncData.getData(fresh.upcoming.data));

      const reloaded: AppModel = {
        ...fresh,
        calendar: { ...fresh.calendar, now: entry.due - 60_000 },
        reminders: {
          ...fresh.reminders,
          context: { ...fresh.reminders.context, active: [] },
        },
      };

      const acceptedEmpty = update(
        reloaded,
        Message.ReceivedUpcoming({
          personId: original.notification.personId,
          request: reloaded.upcoming.request,
          result: { ...saved, events: [] },
        })
      ).model;

      yield* TestClock.setTime(acceptedEmpty.calendar.now);

      const receipt = yield* RestoreReminderSnoozes({
        personId: original.notification.personId,
      }).effect;

      const restored = update(acceptedEmpty, receipt).model;
      const query = Option.getOrThrow(restored.upcoming.query);

      expect(query.range.start).toBe(
        DateTime.formatIso(
          DateTime.makeUnsafe(restored.calendar.now - 1440 * 60_000 - 1)
        )
      );

      const waiting = update(
        restored,
        Message.Ticked({ now: entry.due })
      ).model;

      expect(waiting.reminders.context.active).toEqual([]);
      expect(waiting.reminders.context.snoozes).toEqual([entry]);

      const resolved = update(
        waiting,
        Message.ReceivedUpcoming({
          personId: original.notification.personId,
          request: waiting.upcoming.request,
          result: saved,
        })
      ).model;

      expect(resolved.reminders.context.active).toHaveLength(1);
      expect(resolved.reminders.context.active[0]).toMatchObject({
        candidate: {
          body: original.notification.candidate.body,
          title: original.notification.candidate.title,
        },
        card: { snoozedUntil: entry.due },
      });
      expect(resolved.reminders.context.snoozes).toEqual([]);
    })
);
