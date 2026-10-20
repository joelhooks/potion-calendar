import { DateTime, Effect, Option } from "effect";

import { Provider, UnsupportedRecurrenceSplit } from "./errors.js";
import { GoogleCalendarClient } from "./google.js";
import type {
  CalendarEventValue,
  EventFieldsValue,
  EventTimeValue,
} from "./model.js";
import { seriesZoneTime } from "./series-zone-time.js";
import { CalendarReadBudget } from "./sync.js";

const invalid = (message: string) =>
  new Provider({ message, operation: "recurrence", status: 0 });

export const instant = (time: EventTimeValue) =>
  DateTime.make("date" in time ? `${time.date}T00:00:00Z` : time.dateTime);

export const timeValue = Effect.fn("eventTimeValue")(function* timeValue(
  time: EventTimeValue
) {
  const value = instant(time);

  if (Option.isNone(value)) {
    return yield* invalid(
      "Event time is invalid; supply a valid date or offset timestamp"
    );
  }

  return value.value;
});

export const shiftedTime = Effect.fn("shiftedEventTime")(function* shiftedTime(
  master: EventTimeValue,
  selected: EventTimeValue,
  changed: EventTimeValue
) {
  if (
    "dateTime" in master &&
    "dateTime" in selected &&
    "dateTime" in changed &&
    changed.timeZone !== undefined &&
    changed.timeZone !== (selected.timeZone ?? master.timeZone)
  ) {
    return yield* seriesZoneTime(master, selected, changed);
  }

  const masterTime = yield* timeValue(master);
  const selectedTime = yield* timeValue(selected);
  const changedTime = yield* timeValue(changed);

  const moved = DateTime.add(masterTime, {
    milliseconds:
      DateTime.toEpochMillis(changedTime) -
      DateTime.toEpochMillis(selectedTime),
  });

  return "date" in changed
    ? { date: DateTime.formatIsoDateUtc(moved) }
    : {
        dateTime: DateTime.formatIso(moved),
        timeZone: "dateTime" in master ? master.timeZone : changed.timeZone,
      };
});

export const seriesChanges = Effect.fn("seriesChanges")(function* seriesChanges(
  master: CalendarEventValue,
  selected: CalendarEventValue,
  changes: EventFieldsValue
) {
  const start =
    changes.start === undefined ||
    master.start === undefined ||
    selected.start === undefined
      ? changes.start
      : yield* shiftedTime(master.start, selected.start, changes.start);

  const end =
    changes.end === undefined ||
    master.end === undefined ||
    selected.end === undefined
      ? changes.end
      : yield* shiftedTime(master.end, selected.end, changes.end);

  return { ...changes, end, start };
});

export const splitRecurrence = Effect.fn("splitRecurrence")(
  function* splitRecurrence(
    master: CalendarEventValue,
    selected: CalendarEventValue
  ) {
    const anchor = selected.originalStartTime ?? selected.start;

    if (anchor === undefined) {
      return yield* invalid(
        "Recurring instance omitted its original start time"
      );
    }

    const boundary = yield* timeValue(anchor);

    const cutoff = DateTime.subtract(
      boundary,
      "date" in anchor ? { days: 1 } : { seconds: 1 }
    );

    const until =
      "date" in anchor
        ? DateTime.formatIsoDateUtc(cutoff).replaceAll("-", "")
        : DateTime.formatIso(cutoff)
            .replaceAll(/[-:]/gu, "")
            .replace(/\.\d{3}Z$/u, "Z");

    const rules = master.recurrence ?? [];

    if (rules.filter((rule) => rule.startsWith("RRULE:")).length !== 1) {
      return yield* new UnsupportedRecurrenceSplit({ reason: "multipleRules" });
    }

    if (rules.some((rule) => rule.startsWith("RDATE"))) {
      return yield* new UnsupportedRecurrenceSplit({ reason: "rdate" });
    }

    const counts = rules.flatMap(
      (rule) =>
        /(?:RRULE:|;)COUNT=(?<count>\d+)/u.exec(rule)?.groups?.count ?? []
    );

    if (counts.length > 0 && rules.some((rule) => rule.startsWith("EXDATE"))) {
      return yield* new UnsupportedRecurrenceSplit({
        reason: "countWithExdate",
      });
    }

    let preceding = 0;

    if (counts.length > 0) {
      const google = yield* GoogleCalendarClient;
      const budget = yield* CalendarReadBudget;
      let pageToken: string | undefined;
      const seen = new Set<string>();

      for (let pageNumber = 0; ; pageNumber += 1) {
        if (pageNumber >= budget.maxPages) {
          return yield* invalid(
            "Counting finite recurrence exceeded the page budget"
          );
        }

        const page = yield* google.instancesPage(master, pageToken);

        for (const instance of page.events) {
          const original = instance.originalStartTime ?? instance.start;

          if (original === undefined) {
            return yield* invalid(
              "Google omitted the original time needed to split a COUNT series"
            );
          }

          const value = yield* timeValue(original);

          if (
            DateTime.toEpochMillis(value) < DateTime.toEpochMillis(boundary)
          ) {
            preceding += 1;
          }
        }

        if (page.nextPageToken === undefined) {
          break;
        }

        if (seen.has(page.nextPageToken)) {
          return yield* invalid("Google repeated an instances page token");
        }

        seen.add(page.nextPageToken);
        pageToken = page.nextPageToken;
      }
    }

    const truncate = rules.map((rule) => {
      if (!rule.startsWith("RRULE:")) {
        return rule;
      }

      const parts = rule
        .slice("RRULE:".length)
        .split(";")
        .filter(
          (part) => !part.startsWith("COUNT=") && !part.startsWith("UNTIL=")
        );

      return `RRULE:${[...parts, `UNTIL=${until}`].join(";")}`;
    });

    if (counts.some((count) => Number(count) <= preceding)) {
      return yield* new UnsupportedRecurrenceSplit({ reason: "invalidCount" });
    }

    const successor = rules.map((rule) =>
      rule.replace(
        /COUNT=(?<count>\d+)/u,
        (_match, count: string) => `COUNT=${Number(count) - preceding}`
      )
    );

    return { successor, truncate };
  }
);
