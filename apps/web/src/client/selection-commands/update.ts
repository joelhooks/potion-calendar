import { Option, Schema } from "effect";

import { eventSelectionKey } from "../../layout/event-selection.js";
import type { AppModel } from "../app.js";
import { goToSelection } from "../keyboard/update.js";
import type { KeyboardResult } from "../keyboard/update.js";
import type { AppMessage } from "../message.js";
import {
  OccurrenceNotice,
  OccurrenceProblem,
  OccurrenceTask,
} from "./model.js";
import { ownsOccurrenceTask } from "./source.js";

const sameTask = Schema.toEquivalence(OccurrenceTask);

export const receiveOccurrence = (
  model: AppModel,
  notice: typeof OccurrenceNotice.Type,
  apply: (model: AppModel, message: AppMessage) => KeyboardResult
): KeyboardResult => {
  const pending = Option.getOrUndefined(model.selectionCommands.task);

  if (
    pending === undefined ||
    !sameTask(pending, notice.task) ||
    !ownsOccurrenceTask(model, pending)
  ) {
    return { model };
  }

  if (OccurrenceNotice.guards.Loading(notice)) {
    return {
      model: {
        ...model,
        selectionCommands: {
          ...model.selectionCommands,
          notice: Option.some(notice),
        },
      },
    };
  }

  const settled = {
    ...model,
    selectionCommands: {
      ...model.selectionCommands,
      notice: Option.some(notice),
      task: Option.none<typeof OccurrenceTask.Type>(),
    },
  };

  if (OccurrenceNotice.guards.Failed(notice) || notice.event === null) {
    return { model: settled };
  }

  const { event } = notice;
  const { anchor } = pending;

  if (
    event.accountId !== anchor.accountId ||
    event.calendarId !== anchor.calendarId ||
    event.recurringEventId !== anchor.recurringEventId ||
    (anchor.iCalUID !== undefined && event.iCalUID !== anchor.iCalUID) ||
    event.eventId === anchor.eventId ||
    event.status === "cancelled"
  ) {
    return {
      model: {
        ...settled,
        selectionCommands: {
          ...settled.selectionCommands,
          notice: Option.some(
            OccurrenceNotice.cases.Failed.make({
              problem: OccurrenceProblem.cases.Transport.make({}),
              task: pending,
            })
          ),
        },
      },
    };
  }

  return goToSelection(
    {
      ...settled,
      calendar: {
        ...settled.calendar,
        selected: [eventSelectionKey(event, model.calendar.mergeDuplicates)],
      },
    },
    apply
  );
};
