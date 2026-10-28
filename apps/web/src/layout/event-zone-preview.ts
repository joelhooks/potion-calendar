import { DateTime, Option } from "effect";

import type { EventDraftValue } from "../client/editing/editor-model.js";
import { editorLocalTime } from "./editor-time.js";
import { dayFromIso } from "./navigation.js";
import { dayLabel } from "./presentation.js";
import { formatClock } from "./time-format.js";
import type { ResolvedTimeFormat } from "./time-format.js";
import { zoneOffset } from "./time-zones-display.js";
import { zoneCity } from "./time-zones.js";

const relativeDate = (
  eventDate: string,
  primaryDate: string,
  locale: string
): string => {
  const difference = dayFromIso(primaryDate) - dayFromIso(eventDate);

  if (difference === 0) {
    return "";
  }

  if (difference === -1) {
    return " on the previous day";
  }

  return difference === 1
    ? " on the next day"
    : ` on ${dayLabel(
        dayFromIso(primaryDate),
        {
          day: "numeric",
          month: "long",
          weekday: "long",
          year:
            eventDate.slice(0, 4) === primaryDate.slice(0, 4)
              ? undefined
              : "numeric",
        },
        locale
      )}`;
};

const clock = (
  value: DateTime.Zoned,
  format: ResolvedTimeFormat,
  locale: string
): string => {
  const { hour, minute } = DateTime.toParts(value);

  return formatClock(hour * 60 + minute, format, locale);
};

export const eventZoneLabel = (draft: EventDraftValue): string => {
  const offset = editorLocalTime(
    draft.startDate,
    draft.startTime,
    draft.timeZone
  ).pipe(
    Option.map(
      (instant) =>
        ` · ${zoneOffset(DateTime.toEpochMillis(instant), draft.timeZone)}`
    ),
    Option.getOrElse(() => "")
  );

  return `${zoneCity(draft.timeZone)}${offset}`;
};

export const eventZonePreview = (
  draft: EventDraftValue,
  primaryZone: string,
  format: ResolvedTimeFormat,
  locale = "en-US"
): Option.Option<string> => {
  if (draft.allDay) {
    return Option.none();
  }

  return editorLocalTime(draft.startDate, draft.startTime, draft.timeZone).pipe(
    Option.flatMap((eventStart) =>
      DateTime.makeZoned(eventStart, { timeZone: primaryZone }).pipe(
        Option.map(
          (primaryStart) =>
            `Start: ${clock(eventStart, format, locale)} ${draft.timeZone} · ${clock(primaryStart, format, locale)}${relativeDate(draft.startDate, DateTime.formatIsoDate(primaryStart), locale)} in your primary zone (${primaryZone}).`
        )
      )
    )
  );
};
