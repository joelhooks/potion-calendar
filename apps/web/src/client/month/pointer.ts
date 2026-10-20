import { Option, Schema } from "effect";

import { monthCellAt } from "../../layout/month-hit.js";
import { GesturePoint } from "../editing/gesture-model.js";

export const monthPointerPoint = (
  root: Element,
  event: PointerEvent
): Option.Option<typeof GesturePoint.Type> => {
  const cells = [
    ...root.querySelectorAll<HTMLElement>(".month-cell[data-day]"),
  ].flatMap((element) => {
    if (element.closest("[data-month-parked]") !== null) {
      return [];
    }

    const day = Schema.decodeOption(Schema.Int)(Number(element.dataset.day));
    const rect = element.getBoundingClientRect();

    return Option.isSome(day) && rect.width > 0 && rect.height > 0
      ? [
          {
            bottom: rect.bottom,
            day: day.value,
            left: rect.left,
            right: rect.right,
            top: rect.top,
          },
        ]
      : [];
  });

  return monthCellAt(cells, event.clientX, event.clientY).pipe(
    Option.map((day) =>
      GesturePoint.make({
        alt: event.altKey,
        at: event.timeStamp,
        day,
        minute: 0,
        pointerId: event.pointerId,
        shift: event.shiftKey,
        x: event.clientX,
        y: event.clientY,
      })
    )
  );
};
