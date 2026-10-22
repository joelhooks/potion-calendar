import { setupEffect } from "@xstate/effect";
import { Option, Schema } from "effect";
import { transition } from "xstate";
import type { EventFromLogic } from "xstate";

import {
  TimeBlockDraft,
  TimeBlockEditor,
  TimeBlockEditorContext,
  blankBlockDraft,
} from "./model.js";

export const timeBlockEditorMachine = setupEffect({
  schemas: {
    context: TimeBlockEditorContext,
    events: {
      CANCEL: Schema.Struct({}),
      INPUT: Schema.Struct({ draft: TimeBlockDraft }),
      INVALID: Schema.Struct({ message: Schema.String }),
      OPEN: Schema.Struct({ draft: TimeBlockDraft }),
      SAVE: Schema.Struct({}),
    },
  },
}).createMachine({
  context: { draft: blankBlockDraft(), error: Option.none(), sequence: 0 },
  initial: "closed",
  states: {
    closed: {
      on: {
        OPEN: {
          context: ({ context, event }) => ({
            draft: event.draft,
            error: Option.none(),
            sequence: Math.max(context.sequence, event.draft.id),
          }),
          target: "editing",
        },
      },
    },
    editing: {
      on: {
        CANCEL: {
          context: { draft: blankBlockDraft(), error: Option.none() },
          target: "closed",
        },
        INPUT: {
          context: ({ event }) => ({
            draft: event.draft,
            error: Option.none(),
          }),
        },
        INVALID: {
          context: ({ event }) => ({ error: Option.some(event.message) }),
        },
        SAVE: {
          context: { draft: blankBlockDraft(), error: Option.none() },
          target: "closed",
        },
      },
    },
  },
});

export const stepTimeBlockEditor = (
  state: typeof TimeBlockEditor.Type,
  event: EventFromLogic<typeof timeBlockEditorMachine>
): typeof TimeBlockEditor.Type => {
  const snapshot = timeBlockEditorMachine.resolveState(state);
  const [next] = transition(timeBlockEditorMachine, snapshot, event);

  return {
    context: next.context,
    value: Schema.decodeSync(TimeBlockEditor.fields.value)(next.value),
  };
};
