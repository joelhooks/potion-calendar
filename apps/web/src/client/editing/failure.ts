import {
  CalendarEvent,
  CalendarFailure,
  CalendarReadFailure,
  SeriesMoveRetimeFailure,
} from "@calendar/calendar/contracts";
import { Predicate, Schema } from "effect";

import { MutationFeatureUnavailable } from "./feature-unavailable.js";
import { StatusEventWriteUncertain } from "./status-event-write-uncertain.js";
import { MutationTransportFailure } from "./transport-failure.js";

export { StatusEventWriteUncertain } from "./status-event-write-uncertain.js";

export { MutationFeatureUnavailable } from "./feature-unavailable.js";

export { MutationTransportFailure } from "./transport-failure.js";

const RemoteMutationFailure = Schema.Union([
  CalendarFailure,
  CalendarReadFailure,
  MutationTransportFailure,
  MutationFeatureUnavailable,
  SeriesMoveRetimeFailure,
]);

export class MutationFollowupPartial extends Schema.TaggedError<MutationFollowupPartial>()(
  "MutationFollowupPartial",
  { cause: RemoteMutationFailure, movedEvent: CalendarEvent }
) {}

export const MutationFailure = Schema.Union([
  RemoteMutationFailure,
  MutationFollowupPartial,
  StatusEventWriteUncertain,
]);

export type MutationFailureValue = typeof MutationFailure.Type;

export const needsCalendarReview = (failure: MutationFailureValue): boolean =>
  Predicate.isTagged(failure, "SeriesMoveRetimePartial") ||
  Predicate.isTagged(failure, "SeriesMoveRetimeUncertain") ||
  Predicate.isTagged(failure, "MutationFollowupPartial") ||
  Predicate.isTagged(failure, "StatusEventWriteUncertain");
