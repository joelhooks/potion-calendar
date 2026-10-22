import { createEffectLogic, setupEffect } from "@xstate/effect";
import { Effect, Result } from "effect";
import { types } from "xstate";

import { OccurrenceClient } from "./client.js";
import { OccurrenceNotice, OccurrenceTask } from "./model.js";

interface OccurrenceContext {
  readonly notice: typeof OccurrenceNotice.Type;
  readonly task: typeof OccurrenceTask.Type;
}

const read = createEffectLogic({
  effect: ({ input }) =>
    OccurrenceClient.use((client) => client.read(input.request)).pipe(
      Effect.result
    ),
  schemas: { input: OccurrenceTask },
});

export const occurrenceNavigationMachine = setupEffect({
  actors: { read },
  schemas: { context: types<OccurrenceContext>(), input: OccurrenceTask },
}).createMachine({
  context: ({ input }) => ({
    notice: OccurrenceNotice.cases.Loading.make({ task: input }),
    task: input,
  }),
  initial: "loading",
  states: {
    absent: { type: "final" },
    failed: { type: "final" },
    found: { type: "final" },
    loading: {
      invoke: {
        input: ({ context }) => context.task,
        onDone: ({ context, event }) =>
          Result.isFailure(event.output)
            ? {
                context: {
                  notice: OccurrenceNotice.cases.Failed.make({
                    problem: event.output.failure,
                    task: context.task,
                  }),
                },
                target: "failed",
              }
            : {
                context: {
                  notice: OccurrenceNotice.cases.Ready.make({
                    event: event.output.success,
                    task: context.task,
                  }),
                },
                target: event.output.success === null ? "absent" : "found",
              },
        src: "read",
      },
    },
  },
});
