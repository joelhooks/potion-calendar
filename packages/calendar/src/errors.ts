import { Schema } from "effect";

import { AccountNotOwned } from "./account-not-owned.js";
import { CalendarMoveRefused } from "./calendar-move-refused.js";
import { ConferencingRefused } from "./conferencing-refused.js";
import { CrossAccountMove } from "./cross-account-move.js";
import { Gone } from "./gone.js";
import { NotConnected } from "./not-connected.js";
import { NotFound } from "./not-found.js";
import { Provider } from "./provider.js";
import { RateLimited } from "./rate-limited.js";
import { RecurrenceRemovalRefused } from "./recurrence-removal-refused.js";
import { ReminderLimitExceeded } from "./reminder-limit-exceeded.js";
import { Revoked } from "./revoked.js";
import { UnsupportedRecurrenceSplit } from "./unsupported-recurrence-split.js";

export { CrossAccountMove } from "./cross-account-move.js";

export { ConferencingRefused } from "./conferencing-refused.js";

export { CalendarMoveRefused } from "./calendar-move-refused.js";

export { ReminderLimitExceeded } from "./reminder-limit-exceeded.js";

export { RecurrenceRemovalRefused } from "./recurrence-removal-refused.js";

export { Gone } from "./gone.js";

export { NotConnected } from "./not-connected.js";

export { NotFound } from "./not-found.js";

export { Provider } from "./provider.js";

export { RateLimited } from "./rate-limited.js";

export { Revoked } from "./revoked.js";

export { UnsupportedRecurrenceSplit } from "./unsupported-recurrence-split.js";

export const CalendarFailure = Schema.Union([
  AccountNotOwned,
  ConferencingRefused,
  NotConnected,
  Revoked,
  NotFound,
  Gone,
  RateLimited,
  Provider,
  UnsupportedRecurrenceSplit,
  CrossAccountMove,
  CalendarMoveRefused,
  ReminderLimitExceeded,
  RecurrenceRemovalRefused,
]);

export type CalendarFailureValue = typeof CalendarFailure.Type;
