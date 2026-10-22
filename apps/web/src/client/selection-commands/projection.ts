import { Option } from "effect";

import { eventSelectionKey } from "../../layout/event-selection.js";
import type { AppModel } from "../app.js";
import { OccurrenceNotice } from "./model.js";

export const selectedOccurrenceEvent = (model: AppModel) => {
  const notice = Option.getOrUndefined(model.selectionCommands.notice);

  return notice !== undefined &&
    OccurrenceNotice.guards.Ready(notice) &&
    notice.event !== null &&
    Option.contains(model.person, notice.task.personId) &&
    model.calendar.selected.includes(
      eventSelectionKey(notice.event, model.calendar.mergeDuplicates)
    )
    ? notice.event
    : undefined;
};
