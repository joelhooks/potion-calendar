import { watchActor } from "@calendar/capability/actor-watch";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import { Effect } from "effect";
import { types } from "xstate";

import { SettingsManagementClient } from "./client.js";
import { ManagementOutcome, ManagementTask } from "./model.js";

interface Context {
  readonly outcome: typeof ManagementOutcome.Type | undefined;
  readonly task: typeof ManagementTask.Type;
}

const perform = createEffectLogic({
  effect: ({ input }) =>
    SettingsManagementClient.use((client) => client.perform(input)).pipe(
      Effect.match({
        onFailure: (problem) =>
          ManagementOutcome.cases.Failed.make({ problem, task: input }),
        onSuccess: (value) =>
          ManagementOutcome.cases.Succeeded.make({ task: input, value }),
      })
    ),
  schemas: { input: ManagementTask },
});

const terminal = (
  outcome: typeof ManagementOutcome.Type
): "succeeded" | "refused" | "unconfirmed" => {
  if (ManagementOutcome.guards.Succeeded(outcome)) {
    return "succeeded";
  }

  return outcome.problem.kind === "unconfirmed" ? "unconfirmed" : "refused";
};

export const settingsManagementMachine = setupEffect({
  actors: { perform },
  schemas: { context: types<Context>(), events: {}, input: ManagementTask },
}).createMachine({
  context: ({ input }) => ({ outcome: undefined, task: input }),
  initial: "writing",
  output: ({ context }) => context.outcome,
  states: {
    refused: { type: "final" },
    succeeded: { type: "final" },
    unconfirmed: { type: "final" },
    writing: {
      invoke: {
        input: ({ context }) => context.task,
        onDone: ({ event }) => ({
          context: { outcome: event.output },
          target: terminal(event.output),
        }),
        src: "perform",
      },
    },
  },
});

export const performSettingsManagement = Effect.fn("performSettingsManagement")(
  function* performSettingsManagement(task: typeof ManagementTask.Type) {
    const actor = yield* createEffectActor(settingsManagementMachine, {
      input: task,
    });

    yield* watchActor("calendar.settingsManagement", actor);
    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Unexpected actor defects must not become a confirmed provider refusal.
    const outcome = yield* join(actor).pipe(Effect.orDie);

    if (outcome === undefined) {
      return yield* Effect.die(
        new Error("Settings operation ended without an outcome")
      );
    }

    return outcome;
  },
  Effect.scoped
);
