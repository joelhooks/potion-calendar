import { Option } from "effect";

import { reminderSnoozeMinutes } from "./model.js";
import type { ReminderMemory } from "./model.js";
import { liveSnoozeIdentities } from "./snooze-identities.js";

export const reminderSnoozeLookback = (
  memory: typeof ReminderMemory.Type,
  now: number
): Option.Option<number> =>
  liveSnoozeIdentities(memory).size === 0
    ? Option.none()
    : Option.some(now - Math.max(...reminderSnoozeMinutes) * 60_000 - 1);
