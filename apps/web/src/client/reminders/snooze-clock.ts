import { watchActor } from "@calendar/capability/actor-watch";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import { Clock, Effect, Option, Schema, Stream } from "effect";

import type { AppModel } from "../app.js";
import { Message } from "../message.js";
import { ReminderSnooze, reminderSnoozeMinutes } from "./model.js";
import type { ReminderMemory } from "./model.js";

const WakeInput = Schema.Struct({ due: ReminderSnooze.fields.due });

const waitForSnoozeClock = createEffectLogic({
  effect: ({ input }) =>
    Effect.gen(function* waitForSnoozeDeadline() {
      const now = yield* Clock.currentTimeMillis;

      const remaining = Math.min(
        input.due - now,
        Math.max(...reminderSnoozeMinutes) * 60_000
      );

      if (remaining > 0) {
        yield* Effect.sleep(remaining);
      }

      return yield* Clock.currentTimeMillis;
    }),
  schemas: { input: WakeInput, output: Schema.Finite },
});

export const reminderSnoozeWakeMachine = setupEffect({
  actors: { waitForSnoozeClock },
  schemas: {
    context: Schema.Struct({ ...WakeInput.fields, observed: Schema.Finite }),
    events: {},
    input: WakeInput,
    output: Schema.Finite,
  },
}).createMachine({
  context: ({ input }) => ({ ...input, observed: 0 }),
  initial: "waiting",
  output: ({ context }) => context.observed,
  states: {
    checking: {
      always: ({ context }) => ({
        target: context.observed >= context.due ? "ready" : "waiting",
      }),
    },
    ready: { type: "final" },
    waiting: {
      invoke: {
        input: ({ context }) => ({ due: context.due }),
        onDone: ({ context, event }) => ({
          context: { ...context, observed: event.output },
          target: "checking",
        }),
        src: "waitForSnoozeClock",
      },
    },
  },
});

export const nextReminderSnoozeWake = (
  memory: typeof ReminderMemory.Type,
  now: number
): Option.Option<number> => {
  let earliest: number | undefined;

  for (const entry of memory.snoozes ?? []) {
    if (entry.due > now && (earliest === undefined || entry.due < earliest)) {
      earliest = entry.due;
    }
  }

  return Option.fromUndefinedOr(earliest);
};

export const reminderSnoozeWakeDependencies = (model: AppModel) => {
  const person =
    model.action === "pending" ? Option.none<string>() : model.person;

  return {
    due: Option.isNone(person)
      ? Option.none<number>()
      : nextReminderSnoozeWake(model.reminders.context, model.calendar.now),
    person,
  };
};

export const reminderSnoozeWakeStream = (
  due: Option.Option<number>
): Stream.Stream<ReturnType<typeof Message.Ticked>> =>
  Option.match(due, {
    onNone: () => Stream.empty,
    onSome: (deadline) =>
      Stream.fromEffect(
        Effect.gen(function* snoozeClockWake() {
          const actor = yield* createEffectActor(reminderSnoozeWakeMachine, {
            input: { due: deadline },
          });

          yield* watchActor("calendar.reminders.snooze-wake", actor);
          // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- join exposes unknown machine failures; unexpected wake failures become defects.
          const now = yield* join(actor).pipe(Effect.orDie);

          return Message.Ticked({ now });
        }).pipe(Effect.scoped)
      ),
  });
