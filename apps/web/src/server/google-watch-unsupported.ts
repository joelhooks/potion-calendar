import type { CalendarFailureValue, Provider } from "@calendar/calendar";
import { Predicate } from "effect";

const recoverableReasons: ReadonlySet<string> = new Set([
  "authError",
  "userRateLimitExceeded",
  "rateLimitExceeded",
  "quotaExceeded",
  "forbiddenForNonOrganizer",
]);

export const unsupportedEventWatch = (
  error: CalendarFailureValue
): error is Provider & {
  readonly reasons: readonly string[];
  readonly status: 400 | 403;
} =>
  Predicate.isTagged(error, "Provider") &&
  error.operation === "events.watch" &&
  [400, 403].includes(error.status) &&
  error.reasons !== undefined &&
  error.reasons.length > 0 &&
  error.reasons.every((reason) => !recoverableReasons.has(reason));
