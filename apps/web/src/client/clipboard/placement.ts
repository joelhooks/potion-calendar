import { DateTime, Effect } from "effect";

import {
  clipboardDayDelta,
  shiftClipboardTimedDates,
} from "../../layout/clipboard-time.js";
import { editorDate, editorLocalTime } from "../../layout/editor-time.js";
import { requireEditorZone } from "../../layout/editor-zone.js";
import type { ClipboardItem, ClipboardRefusalPresentation } from "./model.js";
import {
  ClipboardAnchor,
  ClipboardInputFailure,
  ClipboardRange,
} from "./model.js";

const parts = (value: DateTime.Zoned) => {
  const { hour, minute } = DateTime.toParts(value);

  return {
    date: DateTime.formatIsoDate(value),
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
};

const placeAllDay = Effect.fn("placeAllDayClipboardItem")(function* placeAllDay(
  item: typeof ClipboardItem.Type,
  range: typeof ClipboardRange.cases.AllDay.Type,
  anchor: typeof ClipboardAnchor.Type,
  homeZone: string
) {
  const invalid = () =>
    new ClipboardInputFailure({
      message:
        "Choose a valid calendar date before pasting this all-day event.",
      reason: "invalidRange",
      source: item.source,
    });

  const from = yield* Effect.fromOption(editorDate(range.start)).pipe(
    Effect.mapError(invalid)
  );

  const until = yield* Effect.fromOption(editorDate(range.end)).pipe(
    Effect.mapError(invalid)
  );

  const start = yield* Effect.fromOption(editorDate(anchor.date)).pipe(
    Effect.mapError(invalid)
  );

  const days =
    (DateTime.toEpochMillis(until) - DateTime.toEpochMillis(from)) / 86_400_000;

  if (days <= 0 || !Number.isInteger(days)) {
    return yield* invalid();
  }

  return {
    allDay: true,
    endDate: DateTime.formatIsoDateUtc(DateTime.add(start, { days: days - 1 })),
    endTime: "00:00",
    startDate: anchor.date,
    startTime: "00:00",
    timeZone: homeZone,
  };
});

const placeTimed = Effect.fn("placeTimedClipboardItem")(function* placeTimed(
  item: typeof ClipboardItem.Type,
  range: typeof ClipboardRange.cases.Timed.Type,
  anchor: typeof ClipboardAnchor.Type,
  homeZone: string,
  refusalPresentation?: typeof ClipboardRefusalPresentation.Type
) {
  if (ClipboardAnchor.guards.AllDay(anchor) && anchor.origin !== "month") {
    return yield* new ClipboardInputFailure({
      message: "Choose a time slot before pasting a timed event.",
      reason: "missingTime",
      source: item.source,
    });
  }

  const invalid = () =>
    new ClipboardInputFailure({
      message:
        "This event cannot be pasted at that time without changing its instant or duration.",
      reason: "ambiguousTime",
      source: item.source,
    });

  const timeZone = yield* requireEditorZone(homeZone).pipe(
    Effect.mapError(invalid)
  );

  let timedRange = range;
  let timedAnchor: typeof ClipboardAnchor.cases.Timed.Type;

  if (ClipboardAnchor.guards.AllDay(anchor)) {
    const original = yield* Effect.fromOption(
      DateTime.makeZoned(range.start, { timeZone })
    ).pipe(Effect.mapError(invalid));

    const days = yield* Effect.fromOption(
      clipboardDayDelta(DateTime.formatIsoDate(original), anchor.date)
    ).pipe(Effect.mapError(invalid));

    timedRange = yield* shiftClipboardTimedDates({
      days,
      homeZone: timeZone,
      range,
      refusalPresentation,
      source: item.source,
      title: item.content.title,
    });
    timedAnchor = ClipboardAnchor.cases.Timed.make({
      date: anchor.date,
      instant: timedRange.start,
    });
  } else {
    timedAnchor = anchor;
  }

  const duration = timedRange.end - timedRange.start;

  if (!Number.isFinite(duration) || duration <= 0) {
    return yield* invalid();
  }

  const from = yield* Effect.fromOption(
    DateTime.makeZoned(timedAnchor.instant, { timeZone })
  ).pipe(Effect.mapError(invalid));

  const to = yield* Effect.fromOption(
    DateTime.makeZoned(timedAnchor.instant + duration, { timeZone })
  ).pipe(Effect.mapError(invalid));

  const start = parts(from);
  const end = parts(to);

  const checkedStart = yield* Effect.fromOption(
    editorLocalTime(start.date, start.time, timeZone)
  ).pipe(Effect.mapError(invalid));

  const checkedEnd = yield* Effect.fromOption(
    editorLocalTime(end.date, end.time, timeZone)
  ).pipe(Effect.mapError(invalid));

  if (
    DateTime.toEpochMillis(checkedStart) !== timedAnchor.instant ||
    DateTime.toEpochMillis(checkedEnd) !== timedAnchor.instant + duration
  ) {
    return yield* invalid();
  }

  return {
    allDay: false,
    endDate: end.date,
    endTime: end.time,
    startDate: start.date,
    startTime: start.time,
    timeZone,
  };
});

export const placeClipboardItem = Effect.fn("placeClipboardItem")(
  function* placeClipboardItem(
    item: typeof ClipboardItem.Type,
    anchor: typeof ClipboardAnchor.Type,
    homeZone: string,
    refusalPresentation?: typeof ClipboardRefusalPresentation.Type
  ) {
    return yield* ClipboardRange.guards.AllDay(item.range)
      ? placeAllDay(item, item.range, anchor, homeZone)
      : placeTimed(item, item.range, anchor, homeZone, refusalPresentation);
  }
);
