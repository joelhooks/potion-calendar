import { equivalenceKey } from "@calendar/calendar/contracts";
import type { CalendarEventValue } from "@calendar/calendar/contracts";

import { eventKey } from "../client/calendar-state.js";

export const eventSelectionKey = (
  event: CalendarEventValue,
  mergeDuplicates: boolean
): string => {
  const identity = equivalenceKey(event);

  return mergeDuplicates && identity !== undefined
    ? JSON.stringify(["equivalent", identity])
    : eventKey(event);
};
