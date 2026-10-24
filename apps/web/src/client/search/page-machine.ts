import { SearchPageTarget } from "@calendar/calendar/contracts";
import { createEffectLogic, setupEffect } from "@xstate/effect";
import { Effect, Option, Result, Schema } from "effect";
import { types } from "xstate";

import type { SearchResponse } from "../../search-contract.js";
import { CalendarSearchClient } from "./client.js";
import { SearchTask } from "./model.js";
import type { SearchProblem } from "./model.js";
import { SearchPageNotice, SearchPageTask } from "./page-model.js";
import type { SearchDirection } from "./page-model.js";
import { forwardSearchTargets, reverseSearchTargets } from "./paging.js";

interface PageContext {
  readonly forward: Option.Option<typeof SearchPageTask.Type>;
  readonly notice: Option.Option<typeof SearchPageNotice.Type>;
  readonly reverse: Option.Option<typeof SearchPageTask.Type>;
  readonly task: typeof SearchTask.Type;
}

const readPage = createEffectLogic({
  effect: ({ input }) =>
    CalendarSearchClient.use((client) =>
      client.search({ ...input.task.request, continuation: input.continuation })
    ).pipe(Effect.result),
  schemas: { input: SearchPageTask },
});

const sameTask = (a: typeof SearchTask.Type, b: typeof SearchTask.Type) =>
  a.revision === b.revision &&
  a.personId === b.personId &&
  a.request.query === b.request.query &&
  a.request.timeZone === b.request.timeZone &&
  a.request.weekStartsOn === b.request.weekStartsOn;

const validPageTask = (
  task: typeof SearchTask.Type,
  page: typeof SearchPageTask.Type,
  direction: typeof SearchDirection.Type
): boolean =>
  sameTask(task, page.task) &&
  page.continuation.pages.length > 0 &&
  page.continuation.pages.every((target) =>
    direction === "reverse"
      ? SearchPageTarget.guards.Reverse(target)
      : SearchPageTarget.guards.Forward(target) ||
        SearchPageTarget.guards.Initial(target)
  );

const completePage = (
  direction: typeof SearchDirection.Type,
  page: typeof SearchPageTask.Type,
  result: Result.Result<typeof SearchResponse.Type, typeof SearchProblem.Type>
) => {
  if (Result.isFailure(result)) {
    return {
      context: {
        notice: Option.some(
          SearchPageNotice.cases.Failed.make({
            direction,
            page,
            problem: result.failure,
          })
        ),
      },
      target: "failed",
    };
  }

  const response = result.success;

  const failed =
    response.failures.length > 0 || response.accountFailures.length > 0;

  const targets =
    direction === "forward"
      ? forwardSearchTargets(response)
      : reverseSearchTargets(response);

  let target = "idle";

  if (failed) {
    target = "failed";
  } else if (targets.length === 0) {
    target = "exhausted";
  }

  return {
    context: {
      notice: Option.some(
        SearchPageNotice.cases.Ready.make({ direction, page, response })
      ),
    },
    target,
  };
};

export const searchPageMachine = setupEffect({
  actors: { readPage },
  schemas: {
    context: types<PageContext>(),
    events: {
      FORWARD: Schema.Struct({ page: SearchPageTask }),
      REVERSE: Schema.Struct({ page: SearchPageTask }),
    },
    input: SearchTask,
  },
}).createMachine({
  context: ({ input }) => ({
    forward: Option.none(),
    notice: Option.none(),
    reverse: Option.none(),
    task: input,
  }),
  states: {
    forward: {
      initial: "idle",
      on: {
        FORWARD: ({ context, event }) =>
          validPageTask(context.task, event.page, "forward")
            ? {
                context: {
                  forward: Option.some(event.page),
                  notice: Option.some(
                    SearchPageNotice.cases.Loading.make({
                      direction: "forward",
                      page: event.page,
                    })
                  ),
                },
                target: ".loading",
              }
            : {},
      },
      states: {
        exhausted: {},
        failed: {},
        idle: {},
        loading: {
          invoke: {
            input: ({ context }) => Option.getOrThrow(context.forward),
            onDone: ({ context, event }) =>
              completePage(
                "forward",
                Option.getOrThrow(context.forward),
                event.output
              ),
            src: "readPage",
          },
          on: { FORWARD: {} },
        },
      },
    },
    reverse: {
      initial: "idle",
      on: {
        REVERSE: ({ context, event }) =>
          validPageTask(context.task, event.page, "reverse")
            ? {
                context: {
                  notice: Option.some(
                    SearchPageNotice.cases.Loading.make({
                      direction: "reverse",
                      page: event.page,
                    })
                  ),
                  reverse: Option.some(event.page),
                },
                target: ".loading",
              }
            : {},
      },
      states: {
        exhausted: {},
        failed: {},
        idle: {},
        loading: {
          invoke: {
            input: ({ context }) => Option.getOrThrow(context.reverse),
            onDone: ({ context, event }) =>
              completePage(
                "reverse",
                Option.getOrThrow(context.reverse),
                event.output
              ),
            src: "readPage",
          },
          on: { REVERSE: {} },
        },
      },
    },
  },
  type: "parallel",
});
