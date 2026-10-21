import { EventRef } from "@calendar/calendar/contracts";
import { setupEffect } from "@xstate/effect";
import { Option, Schema } from "effect";
import { types } from "xstate";
import type { SnapshotFrom } from "xstate";

import { SelectionClipboardSnapshot } from "../../layout/selection-clipboard.js";
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
import { clipboardGroupMachine } from "./group-machine.js";
import type {
  ClipboardGroupPreparation,
  ClipboardGroupResult,
} from "./group-model.js";
import { HydratedCopy, hydrateCopyLogic } from "./hydrate-copy.js";
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
  CreatedGroup: {
    id: Schema.String,
    intentId: Schema.String,
    mutations: Schema.Array(EditorMutation.cases.Saved),
    revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  },
  Cut: {
    copyId: Schema.String,
    id: Schema.String,
    revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    source: EventRef,
  },
  CutGroup: {
    copyId: Schema.String,
    id: Schema.String,
    revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    selection: Schema.NonEmptyArray(Schema.NonEmptyString),
    sources: Schema.NonEmptyArray(EventRef),
  },
});

export interface ClipboardContext {
  readonly choice: typeof ClipboardGuestChoice.Type;
  readonly creatorPhase: "working" | "failed" | "refused";
  readonly envelope: typeof ClipboardEnvelope.Type | undefined;
  readonly failure: typeof ClipboardCreatorProblem.Type | undefined;
  readonly groupPreparation: typeof ClipboardGroupPreparation.Type | undefined;
  readonly groupResult:
    | (typeof ClipboardGroupResult.Type & { readonly id: string })
    | undefined;
  readonly lastNativeSequence: number;
  readonly nativeSessionId: string | undefined;
  readonly pending: typeof PendingClipboardPaste.Type | undefined;
  readonly pendingCopy?:
    | typeof NativeClipboardNotice.cases.Copied.Type
    | undefined;
  readonly personId: string;
  readonly receipt: typeof ClipboardReceipt.Type | undefined;
  readonly receiptRevision: number;
  readonly request: typeof EditorRequest.cases.New.Type | undefined;
  readonly toast: typeof ClipboardToast.Type | undefined;
}

interface NativeDecision {
  readonly context?: Partial<ClipboardContext>;
  readonly target?: "empty" | "ready" | "preparing" | "hydrating";
}

const idleState = (envelope: ClipboardContext["envelope"]) =>
  envelope === undefined ? "empty" : "ready";

const groupFor = (envelope: typeof ClipboardEnvelope.Type) =>
  Schema.decodeUnknownOption(SelectionClipboardSnapshot)({
    copyId: envelope.id,
    members: envelope.items.map((item, index) => ({
      item,
      key: envelope.selectionKeys?.[index],
    })),
    personId: envelope.personId,
    version: 1,
  });

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

  const base = { groupResult: undefined, lastNativeSequence: notice.sequence };
  const toastId = `${notice.sessionId}.${notice.sequence}`;

  return NativeClipboardNotice.match<NativeDecision>(notice, {
    Copied: ({ envelope, mode }) => {
      if (
        envelope.personId !== context.personId ||
        (envelope.items.length > 1 &&
          (Option.isNone(groupFor(envelope)) ||
            new Set(envelope.selectionKeys).size !== envelope.items.length))
      ) {
        return {
          context: {
            ...base,
            envelope: undefined,
            toast: {
              id: toastId,
              message:
                "Copy a complete selection for the current signed-in person.",
            },
          },
          target: "empty",
        };
      }

      const [item] = envelope.items;

      const omitted = envelope.items.some(
        (member) => member.recurring || member.nativeConference
      );

      const group = Option.getOrUndefined(groupFor(envelope));
      let receipt: typeof ClipboardReceipt.Type | undefined;

      if (mode === "cut") {
        receipt =
          envelope.items.length > 1 && group !== undefined
            ? ClipboardReceipt.cases.CutGroup.make({
                copyId: envelope.id,
                id: `${envelope.id}.cut`,
                revision: context.receiptRevision + 1,
                selection: [
                  group.members[0].key,
                  ...group.members.slice(1).map((member) => member.key),
                ],
                sources: [
                  item.source,
                  ...envelope.items.slice(1).map((member) => member.source),
                ],
              })
            : ClipboardReceipt.cases.Cut.make({
                copyId: envelope.id,
                id: `${envelope.id}.cut`,
                revision: context.receiptRevision + 1,
                source: item.source,
              });
      }

      const label =
        envelope.items.length === 1
          ? "event"
          : `${envelope.items.length} events`;

      return {
        context: {
          ...base,
          envelope,
          failure: undefined,
          groupPreparation: undefined,
          groupResult: undefined,
          pending: undefined,
          receipt,
          receiptRevision:
            mode === "cut"
              ? context.receiptRevision + 1
              : context.receiptRevision,
          request: undefined,
          toast: {
            id: toastId,
            message: omitted
              ? `Copied ${label}. Repeat and native conferencing are not copied.`
              : `Copied ${label}.`,
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
          groupPreparation: undefined,
          groupResult: undefined,
          pending: PendingClipboardPaste.make({
            anchor,
            copyId,
            group:
              envelope.items.length > 1
                ? Option.getOrUndefined(groupFor(envelope))
                : undefined,
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

const creatingState = (context: ClipboardContext) =>
  context.groupPreparation === undefined ? "creating" : "groupCreating";

const clearPaste = (context: ClipboardContext) => ({
  context: {
    creatorPhase: "working" as const,
    failure: undefined,
    groupPreparation: undefined,
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
}): NativeDecision => {
  const { notice } = event;

  if (
    notice.personId !== context.personId ||
    notice.sessionId !== context.nativeSessionId ||
    notice.sequence <=
      Math.max(context.lastNativeSequence, context.pendingCopy?.sequence ?? 0)
  ) {
    return {};
  }

  if (
    NativeClipboardNotice.guards.Copied(notice) &&
    (notice.envelope.personId !== context.personId ||
      (notice.envelope.items.length > 1 &&
        (Option.isNone(groupFor(notice.envelope)) ||
          new Set(notice.envelope.selectionKeys).size !==
            notice.envelope.items.length)))
  ) {
    return nativeDecision(context, notice);
  }

  if (
    NativeClipboardNotice.guards.Copied(notice) &&
    notice.envelope.items.some(
      (item) => item.creationFields.attachments === undefined
    )
  ) {
    return {
      context: {
        pendingCopy: notice,
        toast: {
          id: notice.envelope.id,
          message: "Reading event attachments from Google…",
        },
      },
      target: "hydrating",
    };
  }

  const decision = nativeDecision(context, notice);

  return {
    ...decision,
    context: { ...decision.context, pendingCopy: undefined },
  };
};

const clipboard = setupEffect({
  actors: {
    creator: clipboardCreatorMachine,
    group: clipboardGroupMachine,
    hydrate: hydrateCopyLogic,
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
    groupPreparation: undefined,
    groupResult: undefined,
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
    ATTACH_NATIVE: ({ context, event }) => {
      if (context.nativeSessionId === event.sessionId) {
        return {};
      }

      const changed = {
        context: {
          lastNativeSequence: 0,
          nativeSessionId: event.sessionId,
          pendingCopy: undefined,
        },
      };

      return context.pendingCopy === undefined
        ? changed
        : { ...changed, target: `.${idleState(context.envelope)}` };
    },
    DETACH_NATIVE: ({ context, event }) => {
      if (context.nativeSessionId !== event.sessionId) {
        return {};
      }

      const changed = {
        context: { nativeSessionId: undefined, pendingCopy: undefined },
      };

      return context.pendingCopy === undefined
        ? changed
        : { ...changed, target: `.${idleState(context.envelope)}` };
    },
    DISMISS_TOAST: ({ context, event }) => ({
      context: {
        groupResult:
          context.groupResult?.id === event.id
            ? undefined
            : context.groupResult,
        toast: context.toast?.id === event.id ? undefined : context.toast,
      },
    }),
    RETIRE: () => ({
      context: {
        envelope: undefined,
        failure: undefined,
        groupPreparation: undefined,
        groupResult: undefined,
        nativeSessionId: undefined,
        pending: undefined,
        pendingCopy: undefined,
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
    groupCreating: {
      invoke: clipboard.createInvoke({
        input: ({ context }) => {
          if (context.groupPreparation === undefined) {
            throw new Error("Group paste has no prepared requests");
          }

          return context.groupPreparation;
        },
        onDone: ({ context, event }) => ({
          context: {
            groupPreparation: undefined,
            groupResult: { ...event.output, id: pendingFor(context).intentId },
            pending: undefined,
            receipt: ClipboardReceipt.cases.CreatedGroup.make({
              id: `${pendingFor(context).intentId}.created`,
              intentId: pendingFor(context).intentId,
              mutations: event.output.mutations,
              revision: context.receiptRevision + 1,
            }),
            receiptRevision: context.receiptRevision + 1,
          },
          target: idleState(context.envelope),
        }),
        onError: ({ context }) => ({
          context: {
            groupPreparation: undefined,
            pending: undefined,
            toast: {
              id: pendingFor(context).intentId,
              message:
                "Group paste stopped with an unconfirmed result. Refresh before creating another copy.",
            },
          },
          target: idleState(context.envelope),
        }),
        src: clipboardGroupMachine,
      }),
    },
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
                target:
                  event.choice === "exclude"
                    ? creatingState(context)
                    : "preparing",
              }
            : {},
      },
    },
    hydrating: {
      invoke: clipboard.createInvoke({
        input: ({ context }) => {
          if (context.pendingCopy === undefined) {
            throw new Error("Missing clipboard source read");
          }

          return context.pendingCopy;
        },
        onDone: ({ context, event }) => {
          const pending = context.pendingCopy;

          if (
            pending === undefined ||
            pending.personId !== context.personId ||
            pending.sessionId !== context.nativeSessionId ||
            pending.sequence <= context.lastNativeSequence
          ) {
            return {
              context: { pendingCopy: undefined },
              target: idleState(context.envelope),
            };
          }

          if (HydratedCopy.guards.Ready(event.output)) {
            const decision = nativeDecision(context, event.output.notice);

            return {
              ...decision,
              context: { ...decision.context, pendingCopy: undefined },
              target: decision.target ?? idleState(context.envelope),
            };
          }

          return {
            context: {
              lastNativeSequence: pending.sequence,
              pendingCopy: undefined,
              toast: {
                id: pending.envelope.id,
                message: event.output.failure.message,
              },
            },
            target: idleState(context.envelope),
          };
        },
        onError: ({ context }) => ({
          context: {
            pendingCopy: undefined,
            toast: {
              id: context.pendingCopy?.envelope.id ?? "copy-read",
              message:
                "The Google event read failed. Nothing was copied or cut.",
            },
          },
          target: idleState(context.envelope),
        }),
        src: hydrateCopyLogic,
      }),
      on: {
        NATIVE: (args) => {
          if (NativeClipboardNotice.guards.Paste(args.event.notice)) {
            return {};
          }

          const decision = nativeTransition(args);

          return decision.target === "hydrating"
            ? { ...decision, target: "hydratingAgain" }
            : decision;
        },
      },
    },
    hydratingAgain: { always: () => ({ target: "hydrating" }) },
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
                groupPreparation: undefined,
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

          if (ClipboardPreparation.guards.PreparedGroup(event.output)) {
            const { group } = pendingFor(context);

            return {
              context: { groupPreparation: event.output },
              target:
                context.choice === "exclude" &&
                event.output.requests.length > 0 &&
                group !== undefined &&
                group.members.some(
                  (member) =>
                    member.item.guests.length > 0 || !member.item.guestsComplete
                )
                  ? "guests"
                  : "groupCreating",
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
            groupPreparation: undefined,
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
