import { setupEffect } from "@xstate/effect";
import { Schema } from "effect";
import { types } from "xstate";

import { mutationFailureMessage } from "../../layout/mutation-failure.js";
import { EditorInputFailure } from "../editing/input-failure.js";
import {
  clipboardCreatorMachine,
  ClipboardCreatorOutcome,
} from "./creator-machine.js";
import type { ClipboardCreatorSnapshot } from "./creator-machine.js";
import {
  ClipboardGroupPreparation,
  ClipboardGroupResult,
} from "./group-model.js";
import { ClipboardInputFailure } from "./model.js";

type GroupContext = typeof ClipboardGroupPreparation.Type &
  typeof ClipboardGroupResult.Type & {
    readonly index: number;
    readonly currentFailure: string | undefined;
  };

const currentRequest = (context: GroupContext) => {
  const request = context.requests[context.index];

  if (request === undefined) {
    throw new Error("Group clipboard creation has no current member");
  }

  return request;
};

const nextMember = (context: GroupContext, reason: string) => ({
  context: {
    currentFailure: undefined,
    index: context.index + 1,
    issues: [
      ...context.issues,
      {
        key: currentRequest(context).key,
        reason,
        title: currentRequest(context).title,
      },
    ],
  },
  target: "checking",
});

const groupFailureReason = (
  context: GroupContext,
  snapshot: ClipboardCreatorSnapshot
) => {
  const { failure } = snapshot.context;

  if (failure === undefined) {
    return "The paste result is unconfirmed. Check the calendar before creating another copy.";
  }

  if (
    Schema.is(ClipboardInputFailure)(failure) ||
    Schema.is(EditorInputFailure)(failure)
  ) {
    return failure.message;
  }

  return mutationFailureMessage(
    failure,
    currentRequest(context).request.calendars
  );
};

const group = setupEffect({
  actors: { creator: clipboardCreatorMachine },
  schemas: { context: types<GroupContext>(), input: ClipboardGroupPreparation },
});

export const clipboardGroupMachine = group.createMachine({
  context: ({ input }) => ({
    ...input,
    currentFailure: undefined,
    index: 0,
    mutations: [],
  }),
  initial: "checking",
  output: ({ context }) =>
    ClipboardGroupResult.make({
      issues: context.issues,
      mutations: context.mutations,
    }),
  states: {
    checking: {
      always: ({ context }) => ({
        target:
          context.index < context.requests.length ? "creating" : "finished",
      }),
    },
    creating: {
      invoke: {
        id: "creator",
        input: ({ context }) => ({ request: currentRequest(context).request }),
        onDone: ({ context, event }) =>
          ClipboardCreatorOutcome.match<{
            readonly context: Partial<GroupContext>;
            readonly target: string;
          }>(event.output, {
            Abandoned: () =>
              nextMember(
                context,
                context.currentFailure ??
                  "The paste result is unconfirmed. Check the calendar before creating another copy."
              ),
            Saved: ({ mutation }) => ({
              context: {
                currentFailure: undefined,
                index: context.index + 1,
                mutations: [...context.mutations, mutation],
              },
              target: "checking",
            }),
          }),
        onError: ({ context }) =>
          nextMember(
            context,
            "The paste result is unconfirmed. Check the calendar before creating another copy."
          ),
        onSnapshot: (
          {
            context,
            event,
          }: {
            readonly context: GroupContext;
            readonly event: { readonly snapshot: ClipboardCreatorSnapshot };
          },
          enqueue
        ) => {
          const { snapshot } = event;

          if (
            context.currentFailure !== undefined ||
            !(
              snapshot.matches({ active: "failed" }) ||
              snapshot.matches({ active: "refused" })
            )
          ) {
            return {};
          }

          const reason = groupFailureReason(context, snapshot);

          enqueue.sendTo("creator", { type: "ABANDON" });

          return { context: { currentFailure: reason } };
        },
        src: ({ actors }) => actors.creator,
      },
    },
    finished: { type: "final" },
  },
});
