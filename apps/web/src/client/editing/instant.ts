import { Option } from "effect";

import {
  instantEventEligible,
  instantSourceEligible,
} from "../../layout/instant-editing.js";
import { visibleEvents } from "../../layout/presentation.js";
import type { AppModel } from "../app.js";
import { EditorView } from "./editor-model.js";
import type { EditorMutation } from "./editor-session-model.js";
import { InstantSaveNotice } from "./ui-model.js";

export const instantSavedReceipt = (
  saved: typeof EditorMutation.cases.Saved.Type
): Option.Option<typeof InstantSaveNotice.Type> => {
  const { intent } = saved.plan.session;

  if (
    (intent !== "noEmailOccurrence" && intent !== "noEmailGesture") ||
    saved.plan.sendUpdates !== "none"
  ) {
    return Option.none();
  }

  const notice = InstantSaveNotice.make({
    id: saved.id,
    sendUpdates: "none",
    title: saved.event.title ?? "Untitled event",
  });

  if (intent === "noEmailGesture") {
    const original = Option.getOrUndefined(saved.plan.session.original);

    return Option.some({
      ...notice,
      movement:
        original?.recurringEventId === undefined ? "event" : "occurrence",
    });
  }

  return Option.some(notice);
};

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
