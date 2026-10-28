import { equivalenceKey } from "@calendar/calendar/contracts";
import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { Option } from "effect";

import { eventKey } from "../calendar-state.js";
import { reminderSnoozeOperationIdentity } from "./model.js";
import type { ReminderMemory } from "./model.js";

export const reminderEventIdentity = (event: CalendarEventValue): string => {
  const equivalent = equivalenceKey(event);

  return equivalent === undefined
    ? eventKey(event)
    : JSON.stringify(["equivalent", equivalent]);
};

export const liveSnoozeIdentities = (
  memory: typeof ReminderMemory.Type
): ReadonlySet<string> => {
  const storage = memory.snoozeStorage;

  return new Set([
    ...(memory.snoozes ?? []).map((entry) => entry.identity),
    ...memory.active
      .filter(
        (entry) =>
          entry.card?.snoozedUntil !== undefined ||
          entry.nativeSnoozedUntil !== undefined
      )
      .map((entry) => entry.candidate.identity),
    ...Option.match(reminderSnoozeOperationIdentity(storage), {
      onNone: () => [],
      onSome: (identity) => [identity],
    }),
  ]);
};
