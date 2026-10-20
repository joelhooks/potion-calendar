import { equivalenceKey } from "@calendar/calendar/contracts";

import { calendarKey } from "../client/calendar-state.js";
import type { DisplayEvent, EventCopy } from "./presentation.js";

const tier = (
  event: DisplayEvent,
  primaryAccount: string | undefined
): number => {
  if (event.calendar.accountId === primaryAccount) {
    return event.calendar.primary ? 0 : 1;
  }

  return event.calendar.primary ? 2 : 3;
};

const accountOrder = (id: string, accounts: readonly string[]): number => {
  const position = accounts.indexOf(id);

  return position === -1 ? accounts.length : position;
};

const compareCopies = (
  left: DisplayEvent,
  right: DisplayEvent,
  accounts: readonly string[],
  primaryAccount: string | undefined
): number =>
  tier(left, primaryAccount) - tier(right, primaryAccount) ||
  accountOrder(left.calendar.accountId, accounts) -
    accountOrder(right.calendar.accountId, accounts) ||
  left.calendar.calendarId.localeCompare(right.calendar.calendarId) ||
  left.key.localeCompare(right.key);

const mergeGroup = (
  key: string,
  events: readonly DisplayEvent[],
  accounts: readonly string[],
  primaryAccount: string | undefined
): readonly DisplayEvent[] => {
  const sorted = events.toSorted((left, right) =>
    compareCopies(left, right, accounts, primaryAccount)
  );

  const [representative] = sorted;

  if (representative === undefined) {
    return [];
  }

  const copies = new Map<string, EventCopy>();

  for (const event of sorted) {
    for (const copy of event.copies) {
      const calendar = calendarKey(
        copy.calendar.accountId,
        copy.calendar.calendarId
      );

      if (!copies.has(calendar)) {
        copies.set(calendar, copy);
      }
    }
  }

  return [{ ...representative, copies: [...copies.values()], key }];
};

export const mergeEquivalentEvents = (
  events: readonly DisplayEvent[],
  accounts: readonly string[],
  primaryAccount: string | undefined
): readonly DisplayEvent[] => {
  const groups = new Map<string, DisplayEvent[]>();
  const result: DisplayEvent[] = [];

  for (const event of events) {
    const identity = equivalenceKey(event.source);

    if (identity === undefined) {
      result.push(event);
      continue;
    }

    const key = JSON.stringify(["equivalent", identity]);
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }

  for (const [key, group] of groups) {
    result.push(...mergeGroup(key, group, accounts, primaryAccount));
  }

  return result.toSorted(
    (left, right) =>
      left.startDay - right.startDay ||
      left.startMinute - right.startMinute ||
      left.key.localeCompare(right.key)
  );
};
