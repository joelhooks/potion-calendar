import { Option } from "effect";

import {
  instantEventEligible,
  instantSourceEligible,
} from "../../layout/instant-editing.js";
import { visibleEvents } from "../../layout/presentation.js";
import type { AppModel } from "../app.js";
import { EditorView } from "./editor-model.js";

export const instantDeleteEligible = (model: AppModel): boolean =>
  EditorView.guards.Closed(model.editing.view) &&
  visibleEvents(model).some(
    (item) =>
      model.calendar.selected.includes(item.key) &&
      instantEventEligible(item.source, item.calendar)
  );

export const instantSaveEligible = (model: AppModel): boolean => {
  const { view } = model.editing;

  return (
    (EditorView.guards.Editing(view) ||
      EditorView.guards.Email(view) ||
      EditorView.guards.Scope(view)) &&
    view.kind === "edit" &&
    view.permissions.calendarWritable &&
    view.permissions.editMeeting &&
    Option.isSome(view.original) &&
    instantSourceEligible(view.original.value)
  );
};
