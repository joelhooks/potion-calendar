import { Option, Predicate } from "effect";

import { minuteInZone } from "../../layout/geometry.js";
import { dayInZone, visibleDays } from "../../layout/navigation.js";
import type { AppModel } from "../app.js";
import { ClipboardView } from "../clipboard/model.js";
import { ScrollToNow } from "../commands.js";
import { EditorView } from "../editing/editor-model.js";
import { modelGestureHostKey } from "../editing/gesture-targets.js";
import { timeGridGeometry } from "../time-blocks/grid.js";

export const resumeTimeGrid = (previous: AppModel, now: number) => {
  const model = { ...previous, calendar: { ...previous.calendar, now } };

  if (
    Option.isNone(model.person) ||
    !Predicate.isTagged(model.route, "Calendar") ||
    model.calendar.navigation.mode === "month" ||
    !visibleDays(model.calendar.navigation).includes(
      dayInZone(now, model.calendar.zone)
    ) ||
    !EditorView.guards.Closed(model.editing.view) ||
    model.keyboard.screen !== "closed" ||
    ClipboardView.guards.Guests(model.clipboard.view) ||
    Option.isSome(model.editing.gesture) ||
    Option.isSome(model.timeZones.drag) ||
    Option.isSome(model.calendar.rectangle)
  ) {
    return { model };
  }

  const key = modelGestureHostKey(model);

  if (Option.isNone(key)) {
    return { model };
  }

  const { grid, scale } = timeGridGeometry(model);

  return {
    commands: [
      ScrollToNow({
        hidden: grid.hidden,
        minute: minuteInZone(now, model.calendar.zone),
        resume: {
          day: dayInZone(now, model.calendar.zone),
          hostKey: key.value,
        },
        scale,
      }),
    ],
    model,
  };
};
