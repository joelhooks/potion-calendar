import { disconnectAccountInstruction } from "@calendar/calendar/contracts";
import { watchActor } from "@calendar/capability/actor-watch";
import { expect, it } from "@effect/vitest";
import { createEffectActor, join } from "@xstate/effect";
import { Deferred, Effect, Predicate, Queue, Schema } from "effect";

import { SettingsManagementClient } from "../src/client/settings-management/client.js";
import { settingsManagementMachine } from "../src/client/settings-management/machine.js";
import {
  ManagementOutcome,
  ManagementProblem,
  ManagementTask,
  ManagementValue,
} from "../src/client/settings-management/model.js";

it.effect.prop(
  "a management write forwards its exact task once, remains pending until completion, and never reports a failure as success",
  { problem: ManagementProblem, refused: Schema.Boolean, task: ManagementTask },
  ({ task, refused, problem }) =>
    Effect.gen(function* managementLifecycle() {
      const gate = yield* Deferred.make<
        typeof ManagementValue.Type,
        typeof ManagementProblem.Type
      >();

      const started = yield* Queue.unbounded<typeof ManagementTask.Type>();
      const calls: (typeof ManagementTask.Type)[] = [];

      const client = SettingsManagementClient.of({
        perform: (request) =>
          Effect.gen(function* write() {
            calls.push(request);
            yield* Queue.offer(started, request);

            return yield* Deferred.await(gate);
          }),
      });

      const actor = yield* createEffectActor(settingsManagementMachine, {
        input: task,
      }).pipe(Effect.provideService(SettingsManagementClient, client));

      yield* watchActor("calendar.settingsManagement.test", actor);
      expect(yield* Queue.take(started)).toEqual(task);
      expect(actor.getSnapshot().matches("writing")).toBe(true);
      expect(actor.getSnapshot().status).toBe("active");

      const value = Predicate.isTagged(task, "Colour")
        ? ManagementValue.cases.Colour.make({
            calendar: {
              accessRole: "owner",
              accountId: task.accountId,
              calendarId: task.calendarId,
              colorId: task.colorId,
              primary: false,
              selected: true,
              timeZone: "UTC",
              title: "Fixture calendar",
            },
          })
        : ManagementValue.cases.Removed.make({
            result: {
              accountId: task.accountId,
              disconnected: true,
              instruction: disconnectAccountInstruction,
              revocation: "notAttempted",
            },
          });

      yield* refused
        ? Deferred.fail(gate, problem)
        : Deferred.succeed(gate, value);

      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- A test actor defect is not a successful management outcome.
      const outcome = yield* join(actor).pipe(Effect.orDie);
      expect(outcome).toEqual(
        refused
          ? ManagementOutcome.cases.Failed.make({ problem, task })
          : ManagementOutcome.cases.Succeeded.make({ task, value })
      );
      expect(actor.getSnapshot().status).toBe("done");
      expect(calls).toEqual([task]);

      if (refused) {
        expect(actor.getSnapshot().matches("succeeded")).toBe(false);
      }
    }).pipe(Effect.scoped)
);
