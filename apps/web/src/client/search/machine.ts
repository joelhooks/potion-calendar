import { createEffectLogic, setupEffect } from "@xstate/effect";
import { Effect, Result } from "effect";
import { types } from "xstate";

import { SearchRequest } from "../../search-contract.js";
import { CalendarSearchClient } from "./client.js";
import { SearchNotice, SearchTask } from "./model.js";

interface SearchContext {
  readonly task: typeof SearchTask.Type;
  readonly notice: typeof SearchNotice.Type;
}

const debounce = createEffectLogic({ effect: () => Effect.sleep(250) });

const search = createEffectLogic({
  effect: ({ input }) =>
    CalendarSearchClient.use((client) => client.search(input)).pipe(
      Effect.result
    ),
  schemas: { input: SearchRequest },
});

export const searchMachine = setupEffect({
  actors: { debounce, search },
  schemas: { context: types<SearchContext>(), events: {}, input: SearchTask },
}).createMachine({
  context: ({ input }) => ({
    notice: SearchNotice.cases.Idle.make({ task: input }),
    task: input,
  }),
  initial: "checking",
  states: {
    checking: {
      always: ({ context }) =>
        context.task.request.query === ""
          ? { target: "idle" }
          : {
              context: {
                notice: SearchNotice.cases.Debouncing.make({
                  task: context.task,
                }),
              },
              target: "debouncing",
            },
    },
    debouncing: {
      invoke: {
        onDone: ({ context }) =>
          context.task.request.query.trim() === ""
            ? {
                context: {
                  notice: SearchNotice.cases.Idle.make({ task: context.task }),
                },
                target: "idle",
              }
            : {
                context: {
                  notice: SearchNotice.cases.Searching.make({
                    task: context.task,
                  }),
                },
                target: "searching",
              },
        src: "debounce",
      },
    },
    failed: { type: "final" },
    idle: { type: "final" },
    ready: { type: "final" },
    searching: {
      invoke: {
        input: ({ context }) => context.task.request,
        onDone: ({ context, event }) =>
          Result.isFailure(event.output)
            ? {
                context: {
                  notice: SearchNotice.cases.Failed.make({
                    problem: event.output.failure,
                    task: context.task,
                  }),
                },
                target: "failed",
              }
            : {
                context: {
                  notice: SearchNotice.cases.Ready.make({
                    response: event.output.success,
                    task: context.task,
                  }),
                },
                target: "ready",
              },
        src: "search",
      },
    },
  },
});
