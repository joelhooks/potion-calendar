import { Option, Schema } from "effect";

import type { ClipboardReceipt } from "./machine.js";
import { ClipboardUi } from "./model.js";
import { ClipboardNotice } from "./runtime.js";

export const ClipboardDelivery = Schema.Struct({
  epoch: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  notice: ClipboardNotice,
  personId: Schema.String,
  sessionId: Schema.String,
});

export interface ClipboardDeliveryResult {
  readonly accepted: boolean;
  readonly receipt: Option.Option<typeof ClipboardReceipt.Type>;
  readonly state: typeof ClipboardUi.Type;
}

export const receiveClipboardDelivery = (
  state: typeof ClipboardUi.Type,
  person: Option.Option<string>,
  delivery: typeof ClipboardDelivery.Type
): ClipboardDeliveryResult => {
  const rejected: ClipboardDeliveryResult = {
    accepted: false,
    receipt: Option.none(),
    state,
  };

  if (
    !Option.contains(person, delivery.personId) ||
    state.epoch !== delivery.epoch ||
    (Option.isSome(state.sessionId) &&
      !Option.contains(state.sessionId, delivery.sessionId))
  ) {
    return rejected;
  }

  return ClipboardNotice.match<ClipboardDeliveryResult>(delivery.notice, {
    Receipt: ({ receipt }) => {
      if (
        !Option.contains(state.sessionId, delivery.sessionId) ||
        receipt.revision <= state.receiptRevision
      ) {
        return rejected;
      }

      return {
        accepted: true,
        receipt: Option.some(receipt),
        state: ClipboardUi.make({
          ...state,
          receiptRevision: receipt.revision,
        }),
      };
    },
    State: ({ view }) => {
      if (
        Option.isSome(view.copied) &&
        view.copied.value.personId !== delivery.personId
      ) {
        return rejected;
      }

      return {
        accepted: true,
        receipt: Option.none(),
        state: ClipboardUi.make({
          ...state,
          sessionId: Option.some(delivery.sessionId),
          view,
        }),
      };
    },
  });
};
