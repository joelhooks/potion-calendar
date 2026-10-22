import { CalendarEvent } from "@calendar/calendar/contracts";
import { Option, Schema } from "effect";

import type { AppModel } from "../app.js";
import { selectedReadEvent } from "../keyboard/registry.js";
import type { OccurrenceTask } from "./model.js";

const sameAnchor = Schema.toEquivalence(CalendarEvent);

export const occurrenceContext = (model: AppModel): string =>
  JSON.stringify([model.route, model.calendar.navigation, model.calendar.zone]);

export const ownsOccurrenceTask = (
  model: AppModel,
  task: typeof OccurrenceTask.Type
): boolean => {
  const selected = selectedReadEvent(model);

  return (
    selected !== undefined &&
    Option.contains(model.person, task.personId) &&
    model.calendar.selected[0] === task.selection &&
    occurrenceContext(model) === task.context &&
    sameAnchor(selected.source, task.anchor)
  );
};

export const occurrenceTask = (
  model: AppModel
): Option.Option<typeof OccurrenceTask.Type> =>
  Option.match(model.selectionCommands.task, {
    onNone: () => Option.none(),
    onSome: (task) =>
      ownsOccurrenceTask(model, task) ? Option.some(task) : Option.none(),
  });
