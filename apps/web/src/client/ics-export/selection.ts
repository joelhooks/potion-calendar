import { CalendarEvent } from "@calendar/calendar/contracts";
import { Option, Schema } from "effect";
import { AsyncData } from "foldkit";

import { visibleEvents } from "../../layout/presentation.js";
import type { AppModel } from "../app.js";
import { EditorView } from "../editing/editor-model.js";

export const IcsSelection = Schema.TaggedUnion({
  Ready: {
    events: Schema.NonEmptyArray(CalendarEvent),
    personId: Schema.String,
  },
  Refused: {
    reason: Schema.Literals(["unavailable", "emptySelection", "missingSource"]),
  },
});

export const icsExportAvailable = (model: AppModel): boolean => {
  const session = Option.getOrUndefined(AsyncData.getData(model.session));

  return (
    session !== undefined &&
    session !== null &&
    Option.contains(model.person, session.user.id) &&
    model.calendar.selected.length > 0 &&
    EditorView.guards.Closed(model.editing.view) &&
    model.icsExport.phase !== "saving" &&
    (model.desktop.availability === "unavailable" ||
      (model.desktop.availability === "available" &&
        model.desktop.canSaveIcs === true))
  );
};

export const selectedIcsEvents = (
  model: AppModel
): typeof IcsSelection.Type => {
  if (!icsExportAvailable(model)) {
    return IcsSelection.cases.Refused.make({
      reason:
        model.calendar.selected.length === 0 ? "emptySelection" : "unavailable",
    });
  }

  const candidates = visibleEvents(model);
  const events: (typeof CalendarEvent.Type)[] = [];

  for (const key of model.calendar.selected) {
    const matches = candidates.filter((candidate) => candidate.key === key);
    const [candidate] = matches;

    if (candidate === undefined || matches.length !== 1) {
      return IcsSelection.cases.Refused.make({ reason: "missingSource" });
    }

    events.push(candidate.source);
  }

  const [first, ...rest] = events;

  return first === undefined || Option.isNone(model.person)
    ? IcsSelection.cases.Refused.make({ reason: "emptySelection" })
    : IcsSelection.cases.Ready.make({
        events: [first, ...rest],
        personId: model.person.value,
      });
};
