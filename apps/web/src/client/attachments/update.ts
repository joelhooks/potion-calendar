import type {
  CalendarEventValue,
  ListEventsOutput,
} from "@calendar/calendar/contracts";
import { Option, Predicate } from "effect";
import { AsyncData } from "foldkit";
import type { Command } from "foldkit";

import { visibleEvents } from "../../layout/presentation.js";
import type { SearchResponse } from "../../search-contract.js";
import type { AppModel, AppMessage } from "../app.js";
import { eventKey } from "../calendar-state.js";
import { EditorView } from "../editing/editor-model.js";
import { ReadEventAttachments } from "./commands.js";
import type { AttachmentReadResult } from "./model.js";

interface AttachmentUpdate<Environment = never> {
  readonly model: AppModel;
  readonly commands?: readonly Command.Command<
    AppMessage,
    never,
    Environment
  >[];
}

export const receiveEventAttachments = (
  model: AppModel,
  result: typeof AttachmentReadResult.Type
): AttachmentUpdate => {
  const key = eventKey(result.original);
  const request = model.attachmentReads.reads[key];

  if (
    !Option.contains(model.person, result.personId) ||
    request?.requestId !== result.requestId ||
    request.phase !== "loading"
  ) {
    return { model };
  }

  const event = Option.getOrUndefined(result.event);

  const replace = (current: CalendarEventValue): CalendarEventValue =>
    event !== undefined &&
    eventKey(event) === key &&
    event.attachments !== undefined &&
    JSON.stringify(current) === request.signature
      ? { ...current, attachments: event.attachments }
      : current;

  const replaceRows = (data: typeof ListEventsOutput.Type) => ({
    ...data,
    events: data.events.map(replace),
  });

  return {
    model: {
      ...model,
      attachmentReads: {
        ...model.attachmentReads,
        reads: {
          ...model.attachmentReads.reads,
          [key]: { ...request, phase: "settled" },
        },
      },
      calendar: {
        ...model.calendar,
        reads: model.calendar.reads.map((read) => ({
          ...read,
          events: AsyncData.map(replaceRows)(read.events),
        })),
      },
      search: {
        ...model.search,
        response: Option.map((response: typeof SearchResponse.Type) => ({
          ...response,
          results: response.results.map((item) => ({
            ...item,
            event: replace(item.event),
          })),
        }))(model.search.response),
      },
      upcoming: {
        ...model.upcoming,
        data: AsyncData.map(replaceRows)(model.upcoming.data),
      },
    },
  };
};

export const withEventAttachmentReads = <Environment>(
  result: AttachmentUpdate<Environment>
): AttachmentUpdate<Environment> => {
  const { model } = result;

  if (
    Option.isNone(model.person) ||
    !(
      Predicate.isTagged(model.route, "Calendar") ||
      Predicate.isTagged(model.route, "Search")
    ) ||
    model.settings.hideContextPanel ||
    !EditorView.guards.Closed(model.editing.view) ||
    model.calendar.selected.length !== 1
  ) {
    return result;
  }

  const selected = visibleEvents(model).find((item) => item.selected)?.source;

  if (
    selected === undefined ||
    selected.attachments !== undefined ||
    selected.eventType === "outOfOffice"
  ) {
    return result;
  }

  const key = eventKey(selected);
  const signature = JSON.stringify(selected);
  const previous = model.attachmentReads.reads[key];

  if (previous?.signature === signature) {
    return result;
  }

  const requestId = model.attachmentReads.nextRequestId + 1;

  return {
    commands: [
      ...(result.commands ?? []),
      ReadEventAttachments({
        original: selected,
        personId: model.person.value,
        requestId,
      }),
    ],
    model: {
      ...model,
      attachmentReads: {
        nextRequestId: requestId,
        reads: {
          ...model.attachmentReads.reads,
          [key]: { phase: "loading", requestId, signature },
        },
      },
    },
  };
};
