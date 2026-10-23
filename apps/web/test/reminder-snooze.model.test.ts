import { watchActor } from "@calendar/capability/actor-watch";
import { expect, it } from "@effect/vitest";
import { createEffectActor, send } from "@xstate/effect";
import { Effect, Queue, Schema } from "effect";

import { reminderMachine } from "../src/client/reminders/machine.js";
import { ReminderSnoozeRestore } from "../src/client/reminders/model.js";
import {
  candidatesFor,
  reminderEpoch,
  reminderEvent,
} from "./reminders-fixture.js";

const History = Schema.Array(
  Schema.Struct({
    choice: Schema.Literals([1, 5, 15, 30, 60, 1440]),
    fail: Schema.Boolean,
    stale: Schema.Boolean,
  })
).check(Schema.isMaxLength(15));

it.effect.prop(
  "generated snooze save histories acknowledge only the current operation and retain the last durable deadline through failures and stop",
  { history: History },
  ({ history }) =>
    Effect.gen(function* snoozeHistory() {
      const [candidate] = candidatesFor([reminderEvent(0)]);

      if (candidate === undefined) {
        return yield* Effect.die(
          new Error("Missing generated reminder candidate")
        );
      }

      const actor = yield* createEffectActor(reminderMachine);
      yield* watchActor("calendar.reminders.snooze-generated", actor);

      const snapshots =
        yield* Queue.unbounded<ReturnType<typeof actor.getSnapshot>>();

      yield* Effect.acquireRelease(
        Effect.sync(() =>
          actor.subscribe((snapshot) => {
            Queue.offerUnsafe(snapshots, snapshot);
          })
        ),
        (subscription) =>
          Effect.sync(() => {
            subscription.unsubscribe();
          })
      );

      const events: Parameters<typeof actor.send>[0][] = [
        { now: reminderEpoch, type: "START" },
        { type: "SNOOZE_LOADING" },
        {
          now: reminderEpoch,
          outcome: ReminderSnoozeRestore.cases.Restored.make({ entries: [] }),
          type: "SNOOZE_RESTORED",
        },
      ];

      for (const event of events) {
        yield* send(actor, event);
        yield* Queue.take(snapshots);
      }

      let expected: readonly {
        readonly due: number;
        readonly identity: string;
      }[] = [];

      let operation = 0;

      for (const item of history) {
        operation += 1;

        const entry = {
          due: reminderEpoch + (operation + item.choice) * 60_000,
          identity: candidate.identity,
        };

        const id = `card-${operation}`;

        yield* send(actor, { entry, id, type: "SNOOZE_REQUESTED" });
        const requested = yield* Queue.take(snapshots);

        expect(requested.context.snoozes).toEqual(expected);
        yield* send(actor, {
          entry: { ...entry, due: entry.due + 1 },
          id,
          type: "SNOOZE_REQUESTED",
        });
        yield* Queue.take(snapshots);

        if (item.stale) {
          yield* send(actor, {
            entry,
            failed: false,
            id: `${id}:stale`,
            type: "SNOOZE_SAVED",
          });
          const ignored = yield* Queue.take(snapshots);

          expect(ignored.context.snoozes).toEqual(expected);
        }

        yield* send(actor, {
          entry,
          failed: item.fail,
          id,
          type: "SNOOZE_SAVED",
        });
        const acknowledged = yield* Queue.take(snapshots);

        if (!item.fail) {
          expected = [entry];
        }

        expect(acknowledged.context.snoozes).toEqual(expected);
        yield* send(actor, { entry, failed: false, id, type: "SNOOZE_SAVED" });
        const repeated = yield* Queue.take(snapshots);

        expect(repeated.context.snoozes).toEqual(expected);
      }

      yield* send(actor, { type: "STOP" });
      const stopped = yield* Queue.take(snapshots);

      expect(stopped.context.snoozes).toEqual([]);
      expect(stopped.context.active).toEqual([]);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);
