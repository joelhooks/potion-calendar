import { EffectInterruptedError } from "@xstate/effect";
import { Effect, Option, Schema } from "effect";

import { CalendarFailure } from "./errors.js";
import type { CalendarFailureValue } from "./errors.js";

export const calendarActorFailure = (
  cause: unknown
): Effect.Effect<never, CalendarFailureValue> => {
  const failure = Schema.decodeUnknownOption(CalendarFailure)(cause);

  if (Option.isSome(failure)) {
    return Effect.fail(failure.value);
  }

  const interrupted = Schema.decodeUnknownOption(
    Schema.instanceOf(EffectInterruptedError)
  )(cause);

  if (Option.isSome(interrupted)) {
    return Effect.failCause(interrupted.value.cause);
  }

  return Effect.die(cause);
};
