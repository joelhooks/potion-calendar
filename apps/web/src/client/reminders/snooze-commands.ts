import { watchActor } from "@calendar/capability/actor-watch";
import { NativeNotificationRef } from "@calendar/core/desktop-bridge";
import { createEffectActor, createEffectLogic, join } from "@xstate/effect";
import { Clock, Effect, Schema } from "effect";
import { Command } from "foldkit";

import { Message } from "../message.js";
import {
  ReminderSnooze,
  ReminderSnoozeChoice,
  ReminderSnoozeRestore,
} from "./model.js";
import {
  removeReminderSnoozes,
  restoreReminderSnoozes,
  saveReminderSnooze,
} from "./snooze-storage.js";

const restoreLogic = createEffectLogic({
  effect: ({ input }) =>
    Effect.gen(function* restoreSnoozeCache() {
      const outcome = yield* restoreReminderSnoozes(
        input.personId,
        yield* Clock.currentTimeMillis
      ).pipe(
        Effect.match({
          onFailure: () => ReminderSnoozeRestore.cases.Failed.make({}),
          onSuccess: (entries) =>
            ReminderSnoozeRestore.cases.Restored.make({ entries }),
        })
      );

      return { now: yield* Clock.currentTimeMillis, outcome };
    }),
  schemas: {
    input: Schema.Struct({ personId: Schema.String }),
    output: Schema.Struct({
      now: Schema.Finite,
      outcome: ReminderSnoozeRestore,
    }),
  },
});

const sampleClockLogic = createEffectLogic({
  effect: () => Clock.currentTimeMillis,
  schemas: { input: Schema.Struct({}), output: Schema.Finite },
});

const saveLogic = createEffectLogic({
  effect: ({ input }) =>
    saveReminderSnooze(input.personId, input.entry).pipe(
      Effect.match({ onFailure: () => true, onSuccess: () => false })
    ),
  schemas: {
    input: Schema.Struct({ entry: ReminderSnooze, personId: Schema.String }),
    output: Schema.Boolean,
  },
});

const removeLogic = createEffectLogic({
  effect: ({ input }) =>
    removeReminderSnoozes(input.personId, input.entries).pipe(
      Effect.match({ onFailure: () => true, onSuccess: () => false })
    ),
  schemas: {
    input: Schema.Struct({
      entries: Schema.Array(ReminderSnooze),
      personId: Schema.String,
    }),
    output: Schema.Boolean,
  },
});

export const RestoreReminderSnoozes = Command.define("RestoreReminderSnoozes", {
  args: { personId: Schema.String },
  execute: ({ personId }) =>
    Effect.gen(function* restoreReminderSnoozeCommand() {
      const actor = yield* createEffectActor(restoreLogic, {
        input: { personId },
      });

      yield* watchActor("calendar.reminders.snooze-restore", actor);
      const restored = yield* join(actor).pipe(Effect.orDie);

      return Message.ReminderSnoozesRestored({ ...restored, personId });
    }).pipe(Effect.scoped),
  messages: [Message.ReminderSnoozesRestored],
});

export const SampleReminderSnoozeClock = Command.define(
  "SampleReminderSnoozeClock",
  {
    args: {
      choice: ReminderSnoozeChoice,
      id: Schema.String,
      identity: Schema.String,
      nativeRef: Schema.optional(NativeNotificationRef),
      personId: Schema.String,
    },
    execute: (args) =>
      Effect.gen(function* sampleReminderSnoozeClock() {
        const actor = yield* createEffectActor(sampleClockLogic, { input: {} });

        yield* watchActor("calendar.reminders.snooze-clock", actor);
        const now = yield* join(actor).pipe(Effect.orDie);

        return Message.ReminderSnoozeClockSampled({ ...args, now });
      }).pipe(Effect.scoped),
    messages: [Message.ReminderSnoozeClockSampled],
  }
);

export const PersistReminderSnooze = Command.define("PersistReminderSnooze", {
  args: { entry: ReminderSnooze, id: Schema.String, personId: Schema.String },
  execute: ({ entry, id, personId }) =>
    Effect.gen(function* persistReminderSnooze() {
      const actor = yield* createEffectActor(saveLogic, {
        input: { entry, personId },
      });

      yield* watchActor("calendar.reminders.snooze-save", actor);
      const failed = yield* join(actor).pipe(Effect.orDie);

      return Message.ReminderSnoozeSaved({ entry, failed, id, personId });
    }).pipe(Effect.scoped),
  messages: [Message.ReminderSnoozeSaved],
});

export const RemoveReminderSnoozes = Command.define("RemoveReminderSnoozes", {
  args: { entries: Schema.Array(ReminderSnooze), personId: Schema.String },
  execute: ({ entries, personId }) =>
    Effect.gen(function* removeReminderSnoozeCommand() {
      const actor = yield* createEffectActor(removeLogic, {
        input: { entries, personId },
      });

      yield* watchActor("calendar.reminders.snooze-remove", actor);
      const failed = yield* join(actor).pipe(Effect.orDie);

      return Message.ReminderSnoozeCacheCleaned({ failed, personId });
    }).pipe(Effect.scoped),
  messages: [Message.ReminderSnoozeCacheCleaned],
});
