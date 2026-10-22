import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { DateTime, Option } from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { RemoteEvents, eventKey } from "../src/client/calendar-state.js";
import { OccurrenceNotice } from "../src/client/selection-commands/model.js";
import { eventSelectionKey } from "../src/layout/event-selection.js";
import { selectedReadFixture } from "./selected-event-read-fixture.js";

export const selectionCommandFixture = (recurring = true) => {
  const base = selectedReadFixture("selected");
  const [first] = base.calendar.reads;

  const source =
    first === undefined
      ? undefined
      : Option.getOrUndefined(AsyncData.getData(first.events))?.events[0];

  if (source === undefined || source.start === undefined) {
    throw new Error("Missing selected-event command fixture source");
  }

  const event: CalendarEventValue = recurring
    ? {
        ...source,
        iCalUID: "fixture-series@calendar.test",
        originalStartTime: source.start,
        recurringEventId: "fixture-series",
      }
    : source;

  const model: AppModel = {
    ...base,
    calendar: {
      ...base.calendar,
      mergeDuplicates: false,
      reads: [
        {
          accountId: event.accountId,
          events: RemoteEvents.Success({
            data: { events: [event], versions: [] },
          }),
        },
      ],
      selected: [eventKey(event)],
    },
  };

  return { event, model };
};

export const commandNeighbor = (
  anchor: CalendarEventValue,
  offset = 1
): CalendarEventValue => {
  if (
    anchor.start === undefined ||
    !("dateTime" in anchor.start) ||
    anchor.end === undefined ||
    !("dateTime" in anchor.end)
  ) {
    throw new Error("Expected timed occurrence fixture");
  }

  const shift = (value: string) =>
    DateTime.formatIso(
      DateTime.add(DateTime.makeUnsafe(value), { days: offset })
    );

  const start = { dateTime: shift(anchor.start.dateTime) };

  return {
    ...anchor,
    end: { dateTime: shift(anchor.end.dateTime) },
    eventId: `neighbor-${offset}`,
    originalStartTime: start,
    start,
  };
};

export const beginCommandOccurrence = (
  model: AppModel,
  direction: "next" | "previous"
) => {
  const open = update(model, Message.KeyboardAction({ id: "commands" })).model;

  const loading = update(
    open,
    Message.KeyboardPick({ id: `${direction}-occurrence` })
  ).model;

  const task = Option.getOrThrow(loading.selectionCommands.task);

  return { loading, task };
};

export const commandOccurrenceReady = (
  model: AppModel,
  event: CalendarEventValue | null,
  direction: "next" | "previous" = "next"
) => {
  const { loading, task } = beginCommandOccurrence(model, direction);

  return update(
    loading,
    Message.ReceivedOccurrence({
      notice: OccurrenceNotice.cases.Ready.make({ event, task }),
    })
  );
};

export const commandNeighborKey = (
  model: AppModel,
  event: CalendarEventValue
): string => eventSelectionKey(event, model.calendar.mergeDuplicates);
