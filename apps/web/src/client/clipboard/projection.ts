import { Option, Schema } from "effect";

import { mutationFailureMessage } from "../../layout/mutation-failure.js";
import { EditorInputFailure } from "../editing/input-failure.js";
import type { ClipboardSnapshot } from "./machine.js";
import { ClipboardInputFailure, ClipboardView } from "./model.js";

const failureMessage = (context: ClipboardSnapshot["context"]): string => {
  const { failure } = context;

  if (failure === undefined) {
    return "Paste could not be confirmed. Refresh before trying again.";
  }

  if (
    Schema.is(ClipboardInputFailure)(failure) ||
    Schema.is(EditorInputFailure)(failure)
  ) {
    return failure.message;
  }

  return mutationFailureMessage(
    failure,
    context.pending === undefined ? [] : [context.pending.target.calendar]
  );
};

export const projectClipboard = (
  snapshot: ClipboardSnapshot
): typeof ClipboardView.Type => {
  const { context } = snapshot;

  const fields = {
    copied:
      context.envelope === undefined
        ? Option.none()
        : Option.some({
            id: context.envelope.id,
            personId: context.envelope.personId,
          }),
    toast: Option.fromUndefinedOr(context.toast),
  };

  const { pending } = context;

  if (pending === undefined) {
    return ClipboardView.cases.Idle.make(fields);
  }

  if (snapshot.matches("guests")) {
    return ClipboardView.cases.Guests.make({
      ...fields,
      calendarTitle: pending.target.calendar.title,
      complete: pending.item.guestsComplete,
      count: pending.item.guests.length,
      intentId: pending.intentId,
      title: pending.item.content.title,
    });
  }

  if (snapshot.matches("creating")) {
    if (context.creatorPhase === "working") {
      return ClipboardView.cases.Creating.make({
        ...fields,
        intentId: pending.intentId,
      });
    }

    return ClipboardView.cases.Failure.make({
      ...fields,
      intentId: pending.intentId,
      message: failureMessage(context),
      retryable: context.creatorPhase === "failed",
    });
  }

  return ClipboardView.cases.Preparing.make({
    ...fields,
    intentId: pending.intentId,
  });
};
