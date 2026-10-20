import { EventRef } from "@calendar/calendar/contracts";
import { setupEffect } from "@xstate/effect";
import { Schema } from "effect";
import { types } from "xstate";
import type { SnapshotFrom } from "xstate";

import type { EditorRequest } from "../editing/editor-session-model.js";
import { EditorMutation } from "../editing/editor-session-model.js";
import {
  clipboardCreatorMachine,
  ClipboardCreatorOutcome,
} from "./creator-machine.js";
import type {
  ClipboardCreatorProblem,
  ClipboardCreatorSnapshot,
} from "./creator-machine.js";
import type { ClipboardEnvelope, ClipboardToast } from "./model.js";
import {
  ClipboardGuestChoice,
  ClipboardInputFailure,
  NativeClipboardNotice,
} from "./model.js";
import {
  ClipboardPreparation,
  PendingClipboardPaste,
  prepareClipboardLogic,
} from "./prepare.js";

export const ClipboardReceipt = Schema.TaggedUnion({
  Created: {
    id: Schema.String,
    intentId: Schema.String,
    mutation: EditorMutation.cases.Saved,
    revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  },
  Cut: {
    copyId: Schema.String,
    id: Schema.String,
    revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    source: EventRef,
  },
});

export interface ClipboardContext {
  readonly choice: typeof ClipboardGuestChoice.Type;
  readonly creatorPhase: "working" | "failed" | "refused";
  readonly envelope: typeof ClipboardEnvelope.Type | undefined;
  readonly failure: typeof ClipboardCreatorProblem.Type | undefined;
  readonly lastNativeSequence: number;
  readonly nativeSessionId: string | undefined;
  readonly pending: typeof PendingClipboardPaste.Type | undefined;
  readonly personId: string;
  readonly receipt: typeof ClipboardReceipt.Type | undefined;
  readonly receiptRevision: number;
  readonly request: typeof EditorRequest.cases.New.Type | undefined;
  readonly toast: typeof ClipboardToast.Type | undefined;
}

interface NativeDecision {
  readonly context?: Partial<ClipboardContext>;
  readonly target?: "empty" | "ready" | "preparing";
}

const idleState = (envelope: ClipboardContext["envelope"]) =>
  envelope === undefined ? "empty" : "ready";

const nativeDecision = (
  context: ClipboardContext,
  notice: typeof NativeClipboardNotice.Type
): NativeDecision => {
  if (
    notice.personId !== context.personId ||
    notice.sessionId !== context.nativeSessionId ||
    notice.sequence <= context.lastNativeSequence
  ) {
    return {};
  }

  const base = { lastNativeSequence: notice.sequence };
  const toastId = `${notice.sessionId}.${notice.sequence}`;

  return NativeClipboardNotice.match<NativeDecision>(notice, {
    Copied: ({ envelope, mode }) => {
      if (
        envelope.personId !== context.personId ||
        envelope.items.length !== 1
      ) {
        return {
          context: {
            ...base,
            envelope: undefined,
            toast: {
              id: toastId,
              message: "Copy one event for the current signed-in person.",
            },
          },
          target: "empty",
        };
      }

      const [item] = envelope.items;
      const omitted = item.recurring || item.nativeConference;

      return {
        context: {
          ...base,
          envelope,
          failure: undefined,
          pending: undefined,
          receipt:
            mode === "cut"
              ? ClipboardReceipt.cases.Cut.make({
                  copyId: envelope.id,
                  id: `${envelope.id}.cut`,
                  revision: context.receiptRevision + 1,
                  source: item.source,
                })
              : undefined,
          receiptRevision:
            mode === "cut"
              ? context.receiptRevision + 1
              : context.receiptRevision,
          request: undefined,
          toast: {
            id: toastId,
            message: omitted
              ? "Copied event. Repeat and native conferencing are not copied."
              : "Copied event.",
          },
        },
        target: "ready",
      };
    },
    Invalidated: ({ copyId }) =>
      context.envelope?.id === copyId
        ? {
            context: {
              ...base,
              envelope: undefined,
              toast: {
                id: toastId,
                message: "Clipboard changed. Copy an event before pasting.",
              },
            },
            target: "empty",
          }
        : { context: base },
    Paste: ({ anchor, copyId, target }) => {
      const { envelope } = context;

      if (
        envelope === undefined ||
        envelope.id !== copyId ||
        envelope.personId !== context.personId
      ) {
        return {
          context: {
            ...base,
            toast: {
              id: toastId,
              message:
                "Copy an event for this signed-in person before pasting.",
            },
          },
        };
      }

      const [item] = envelope.items;

      return {
        context: {
          ...base,
          choice: "exclude",
          creatorPhase: "working",
          failure: undefined,
          pending: PendingClipboardPaste.make({
            anchor,
            copyId,
            intentId: `${toastId}.paste`,
            item,
            target,
          }),
          receipt: undefined,
          request: undefined,
          toast: undefined,
        },
        target: "preparing",
      };
    },
    Refused: ({ failure, operation }) => {
      const envelope =
        operation !== "paste" || failure.reason === "personMismatch"
          ? undefined
          : context.envelope;

      return {
        context: {
          ...base,
          envelope,
          toast: { id: toastId, message: failure.message },
        },
        target: idleState(envelope),
      };
    },
  });
};

const creatorPhase = (
  snapshot: ClipboardCreatorSnapshot
): ClipboardContext["creatorPhase"] => {
  if (snapshot.matches({ active: "failed" })) {
    return "failed";
  }

  return snapshot.matches({ active: "refused" }) ? "refused" : "working";
};

const pendingFor = (context: ClipboardContext) => {
  if (context.pending === undefined) {
    throw new Error("Clipboard preparation requires a captured paste intent");
  }

  return context.pending;
};

const requestFor = (context: ClipboardContext) => {
  if (context.request?.template === undefined) {
    throw new Error("Clipboard creation requires a prepared owned template");
  }

  return context.request;
};

const clearPaste = (context: ClipboardContext) => ({
  context: {
    creatorPhase: "working" as const,
    failure: undefined,
    pending: undefined,
    request: undefined,
  },
  target: idleState(context.envelope),
});

const nativeTransition = ({
  context,
  event,
}: {
  readonly context: ClipboardContext;
  readonly event: { readonly notice: typeof NativeClipboardNotice.Type };
}) => nativeDecision(context, event.notice);

const clipboard = setupEffect({
  actors: {
    creator: clipboardCreatorMachine,
    prepare: prepareClipboardLogic,
  },
  schemas: {
    context: types<ClipboardContext>(),
    events: {
      ABANDON: Schema.Struct({ intentId: Schema.String }),
      ATTACH_NATIVE: Schema.Struct({ sessionId: Schema.String }),
      CANCEL: Schema.Struct({ intentId: Schema.String }),
      DETACH_NATIVE: Schema.Struct({ sessionId: Schema.String }),
      DISMISS_TOAST: Schema.Struct({ id: Schema.String }),
      GUESTS: Schema.Struct({
        choice: ClipboardGuestChoice,
        intentId: Schema.String,
      }),
      NATIVE: Schema.Struct({ notice: NativeClipboardNotice }),
      RETIRE: Schema.Struct({}),
      RETRY: Schema.Struct({ intentId: Schema.String }),
    },
    input: Schema.Struct({ personId: Schema.NonEmptyString }),
  },
});

export const clipboardMachine = clipboard.createMachine({
  context: ({ input }) => ({
    choice: "exclude",
    creatorPhase: "working",
    envelope: undefined,
    failure: undefined,
    lastNativeSequence: 0,
    nativeSessionId: undefined,
    pending: undefined,
    personId: input.personId,
    receipt: undefined,
    receiptRevision: 0,
    request: undefined,
    toast: undefined,
  }),
  initial: "empty",
  on: {
    ATTACH_NATIVE: ({ context, event }) =>
      context.nativeSessionId === event.sessionId
        ? {}
        : {
            context: {
              lastNativeSequence: 0,
              nativeSessionId: event.sessionId,
            },
          },
    DETACH_NATIVE: ({ context, event }) =>
      context.nativeSessionId === event.sessionId
        ? { context: { nativeSessionId: undefined } }
        : {},
    DISMISS_TOAST: ({ context, event }) =>
      context.toast?.id === event.id ? { context: { toast: undefined } } : {},
    RETIRE: () => ({
      context: {
        envelope: undefined,
        failure: undefined,
        nativeSessionId: undefined,
        pending: undefined,
        receipt: undefined,
        request: undefined,
        toast: undefined,
      },
      target: ".retired",
    }),
  },
  states: {
    creating: {
      invoke: clipboard.createInvoke({
        id: "creator",
        input: ({ context }) => ({ request: requestFor(context) }),
        onDone: ({ context, event }) => {
          if (ClipboardCreatorOutcome.guards.Abandoned(event.output)) {
            return clearPaste(context);
          }

          const pending = pendingFor(context);

          return {
            context: {
              failure: undefined,
              pending: undefined,
              receipt: ClipboardReceipt.cases.Created.make({
                id: `${pending.intentId}.created`,
                intentId: pending.intentId,
                mutation: event.output.mutation,
                revision: context.receiptRevision + 1,
              }),
              receiptRevision: context.receiptRevision + 1,
              request: undefined,
              toast: { id: pending.intentId, message: "Pasted event." },
            },
            target: idleState(context.envelope),
          };
        },
        onError: ({ context }) => ({
          context: {
            creatorPhase: "refused" as const,
            failure: new ClipboardInputFailure({
              message:
                "Paste outcome is unconfirmed. Refresh before creating another copy.",
              reason: "creationUnconfirmed",
              source: pendingFor(context).item.source,
            }),
          },
        }),
        onSnapshot: ({
          event,
        }: {
          readonly context: ClipboardContext;
          readonly event: { readonly snapshot: ClipboardCreatorSnapshot };
        }) => ({
          context: {
            creatorPhase: creatorPhase(event.snapshot),
            failure: event.snapshot.context.failure,
          },
        }),
        src: clipboardCreatorMachine,
      }),
      on: {
        ABANDON: ({ context, event }, enqueue) => {
          if (
            context.pending?.intentId !== event.intentId ||
            context.creatorPhase === "working"
          ) {
            return {};
          }

          if (
            Schema.is(ClipboardInputFailure)(context.failure) &&
            context.failure.reason === "creationUnconfirmed"
          ) {
            return clearPaste(context);
          }

          enqueue.sendTo("creator", { type: "ABANDON" });

          return {};
        },
        RETRY: ({ context, event }, enqueue) => {
          if (
            context.pending?.intentId === event.intentId &&
            context.creatorPhase === "failed"
          ) {
            enqueue.sendTo("creator", { type: "RETRY" });
          }

          return {};
        },
      },
    },
    empty: { on: { NATIVE: nativeTransition } },
    guests: {
      on: {
        CANCEL: ({ context, event }) =>
          context.pending?.intentId === event.intentId
            ? clearPaste(context)
            : {},
        GUESTS: ({ context, event }) =>
          context.pending?.intentId === event.intentId
            ? {
                context: { choice: event.choice },
                target: event.choice === "exclude" ? "creating" : "preparing",
              }
            : {},
      },
    },
    preparing: {
      invoke: clipboard.createInvoke({
        input: ({ context }) => ({
          choice: context.choice,
          pending: pendingFor(context),
        }),
        onDone: ({ context, event }) => {
          if (ClipboardPreparation.guards.Refused(event.output)) {
            const pending = pendingFor(context);

            return {
              context: {
                failure: undefined,
                pending: undefined,
                request: undefined,
                toast: {
                  id: pending.intentId,
                  message: event.output.failure.message,
                },
              },
              target: idleState(context.envelope),
            };
          }

          return {
            context: { request: event.output.request },
            target:
              context.choice === "exclude" &&
              (pendingFor(context).item.guests.length > 0 ||
                !pendingFor(context).item.guestsComplete)
                ? "guests"
                : "creating",
          };
        },
        onError: ({ context }) => ({
          context: {
            pending: undefined,
            request: undefined,
            toast: {
              id: pendingFor(context).intentId,
              message:
                "Could not prepare this paste. Copy the event again and retry.",
            },
          },
          target: idleState(context.envelope),
        }),
        src: prepareClipboardLogic,
      }),
    },
    ready: { on: { NATIVE: nativeTransition } },
    retired: { type: "final" },
  },
});

export type ClipboardSnapshot = SnapshotFrom<typeof clipboardMachine>;
