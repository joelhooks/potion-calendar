import { Provider } from "@calendar/calendar/contracts";
import { Schema } from "effect";

import { mutationFailureMessage } from "../../layout/mutation-failure.js";
import type { MutationFailureValue } from "../editing/failure.js";
import { EditorInputFailure } from "../editing/input-failure.js";

export const bulkFailureReason = (
  failure: MutationFailureValue | EditorInputFailure
): string => {
  if (Schema.is(EditorInputFailure)(failure) || Schema.is(Provider)(failure)) {
    return failure.message;
  }

  return mutationFailureMessage(failure);
};
