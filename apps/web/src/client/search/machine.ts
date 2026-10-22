import { createEffectLogic, setupEffect } from "@xstate/effect";
import { Effect, Result } from "effect";
import { types } from "xstate";

import { SearchRequest } from "../../search-contract.js";
import type { SearchResponse } from "../../search-contract.js";
import { CalendarSearchClient } from "./client.js";
import { SearchNotice, SearchTask } from "./model.js";
import type { SearchProblem } from "./model.js";

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

const completeSearch = (
  task: typeof SearchTask.Type,
  output: Result.Result<typeof SearchResponse.Type, typeof SearchProblem.Type>
) =>
  Result.isFailure(output)
    ? {
        context: {
          notice: SearchNotice.cases.Failed.make({
            problem: output.failure,
            task,
          }),
        },
        target: "failed",
      }
    : {
        context: {
          notice: SearchNotice.cases.Ready.make({
            response: output.success,
            task,
          }),
        },
        target: "ready",
      };

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
      always: ({ context }) => {
        if (context.task.request.continuation !== undefined) {
          return {
            context: {
              notice: SearchNotice.cases.LoadingMore.make({
                task: context.task,
              }),
            },
            target: "loadingMore",
          };
        }

        return context.task.request.query === ""
          ? { target: "idle" }
          : {
              context: {
                notice: SearchNotice.cases.Debouncing.make({
                  task: context.task,
                }),
              },
              target: "debouncing",
            };
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
    loadingMore: {
      invoke: {
        input: ({ context }) => context.task.request,
        onDone: ({ context, event }) =>
          completeSearch(context.task, event.output),
        src: "search",
      },
    },
    ready: { type: "final" },
    searching: {
      invoke: {
        input: ({ context }) => context.task.request,
        onDone: ({ context, event }) =>
          completeSearch(context.task, event.output),
        src: "search",
      },
    },
  },
});
