import type { EventRef } from "@calendar/calendar/contracts";
import { DateTime, Effect, Option } from "effect";

import {
  ClipboardInputFailure,
  ClipboardRange,
} from "../client/clipboard/model.js";
import { editorDate } from "./editor-time.js";
import { requireEditorZone } from "./editor-zone.js";
import { formatClock } from "./time-format.js";

export const clipboardLocalCoordinates = (instant: number, timeZone: string) =>
  DateTime.makeZoned(instant, { timeZone }).pipe(
    Option.map((zoned) => DateTime.makeUnsafe(DateTime.toParts(zoned))),
    Option.map(DateTime.toEpochMillis)
  );

export const clipboardUniqueLocalInstant = (
  coordinates: number,
  timeZone: string
) =>
  DateTime.make(coordinates).pipe(
    Option.flatMap((local) =>
      DateTime.makeZoned(DateTime.toPartsUtc(local), {
        adjustForTimeZone: true,
        disambiguation: "reject",
        timeZone,
      })
    ),
    Option.map(DateTime.toEpochMillis)
  );

export const clipboardDayDelta = (from: string, to: string) =>
  Option.all([editorDate(from), editorDate(to)]).pipe(
    Option.map(
      ([start, end]) =>
        (DateTime.toEpochMillis(end) - DateTime.toEpochMillis(start)) /
        86_400_000
    ),
    Option.filter(Number.isInteger)
  );

export const clipboardLocalTimeExplanation = (
  coordinates: number,
  zone: string,
  endpoint: "start" | "end",
  title: string
) => {
  const local = DateTime.make(coordinates);

  if (Option.isNone(local)) {
    return Option.none<string>();
  }

  const earlier = DateTime.makeZoned(DateTime.toPartsUtc(local.value), {
    adjustForTimeZone: true,
    disambiguation: "earlier",
    timeZone: zone,
  });

  if (Option.isNone(earlier)) {
    return Option.none<string>();
  }

  const repeated = clipboardLocalCoordinates(
    DateTime.toEpochMillis(earlier.value),
    zone
  ).pipe(Option.contains(coordinates));

  const parts = DateTime.toPartsUtc(local.value);
  const clock = formatClock(parts.hour * 60 + parts.minute);

  const date = DateTime.format(local.value, {
    day: "numeric",
    locale: "en-US",
    month: "short",
  });

  const reason = repeated
    ? "happens twice when clocks fall back"
    : "doesn't exist when clocks spring forward";

  return Option.some(
    `${title} would ${endpoint} at ${clock} on ${date}, which ${reason}. Paste it somewhere else.`
  );
};

export const shiftClipboardTimedDates = Effect.fn("shiftClipboardTimedDates")(
  function* shiftClipboardTimedDates(input: {
    readonly days: number;
    readonly homeZone: string;
    readonly range: typeof ClipboardRange.cases.Timed.Type;
    readonly source: typeof EventRef.Type;
    readonly title: string;
  }) {
    const invalid = (
      message: string,
      reason: "ambiguousTime" | "invalidRange"
    ) => new ClipboardInputFailure({ message, reason, source: input.source });

    if (
      !Number.isInteger(input.days) ||
      !Number.isFinite(input.range.start) ||
      !Number.isFinite(input.range.end) ||
      input.range.end <= input.range.start
    ) {
      return yield* invalid(
        `${input.title} has no valid range or calendar-day shift. Choose another date.`,
        "invalidRange"
      );
    }

    const zone = yield* requireEditorZone(input.homeZone).pipe(
      Effect.mapError(() =>
        invalid(
          "Choose a supported home time zone before pasting.",
          "invalidRange"
        )
      )
    );

    const shifted = { end: input.range.end, start: input.range.start };

    for (const endpoint of ["start", "end"] as const) {
      const coordinates = yield* Effect.fromOption(
        clipboardLocalCoordinates(input.range[endpoint], zone)
      ).pipe(
        Effect.mapError(() =>
          invalid(
            `${input.title} has unsupported home-zone coordinates. Choose another date.`,
            "invalidRange"
          )
        )
      );

      const target = coordinates + input.days * 86_400_000;
      const instant = clipboardUniqueLocalInstant(target, zone);

      if (Option.isNone(instant)) {
        return yield* invalid(
          Option.getOrElse(
            clipboardLocalTimeExplanation(target, zone, endpoint, input.title),
            () =>
              `${input.title} cannot be represented safely on that date. Choose another date.`
          ),
          "ambiguousTime"
        );
      }

      shifted[endpoint] = instant.value;
    }

    if (shifted.end <= shifted.start) {
      return yield* invalid(
        `${input.title} would end before it starts after this date change. Choose another date.`,
        "invalidRange"
      );
    }

    return ClipboardRange.cases.Timed.make(shifted);
  }
);
