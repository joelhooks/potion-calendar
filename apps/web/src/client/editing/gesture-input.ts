import { DateTime, Option, Schema } from "effect";

import { minuteInZone } from "../../layout/geometry.js";
import { dayInZone, dayFromIso } from "../../layout/navigation.js";
import type { DisplayEvent } from "../../layout/presentation.js";
import { GesturePoint, GestureTarget } from "./gesture-model.js";

export const gestureTarget = (
  item: DisplayEvent,
  zone: string
): Option.Option<typeof GestureTarget.Type> => {
  const event = item.source;

  if (event.start === undefined || event.end === undefined) {
    return Option.none();
  }

  const allDay = "date" in event.start;

  const absolute = (time: NonNullable<typeof event.start>) => {
    if ("date" in time) {
      return dayFromIso(time.date) * 1440;
    }

    const instant = DateTime.toEpochMillis(DateTime.makeUnsafe(time.dateTime));

    return dayInZone(instant, zone) * 1440 + minuteInZone(instant, zone);
  };

  return Option.some(
    GestureTarget.make({
      allDay,
      editable:
        (item.calendar.accessRole === "owner" ||
          item.calendar.accessRole === "writer") &&
        (event.organizer?.self === true || event.guestsCanModify === true),
      end: absolute(event.end),
      event,
      key: item.key,
      start: absolute(event.start),
    })
  );
};

export const pointerPoint = (
  root: Element,
  event: PointerEvent,
  scale: number,
  allDay: boolean
): Option.Option<typeof GesturePoint.Type> => {
  const columns = [
    ...root.querySelectorAll<HTMLElement>(
      allDay ? ".all-day-cell[data-day]" : ".day-column[data-day]"
    ),
  ];

  const column =
    columns.find((candidate) => {
      const rect = candidate.getBoundingClientRect();

      return event.clientX >= rect.left && event.clientX < rect.right;
    }) ??
    (event.clientX < (columns[0]?.getBoundingClientRect().left ?? 0)
      ? columns[0]
      : columns.at(-1));

  if (column === undefined) {
    return Option.none();
  }

  const day = Schema.decodeOption(Schema.Int)(Number(column.dataset.day));

  return day.pipe(
    Option.map((value) =>
      GesturePoint.make({
        alt: event.altKey,
        at: event.timeStamp,
        day: value,
        minute: allDay
          ? 0
          : Math.max(
              0,
              Math.min(
                1440,
                ((event.clientY - column.getBoundingClientRect().top) * 60) /
                  scale
              )
            ),
        pointerId: event.pointerId,
        shift: event.shiftKey,
        x: event.clientX,
        y: event.clientY,
      })
    )
  );
};
