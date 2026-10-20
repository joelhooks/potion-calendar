import {
  Calendar,
  CalendarEvent,
  EventRef,
} from "@calendar/calendar/contracts";
import { Effect, Schema } from "effect";

import { EditorRequest } from "../editing/editor-session-model.js";
import { writableCalendar } from "../editing/load-editor.js";
import { ClipboardInputFailure } from "./model.js";

export const ClipboardCutInput = Schema.Struct({
  calendars: Schema.Array(Calendar),
  events: Schema.Array(CalendarEvent),
  navigation: EditorRequest.cases.Existing.fields.navigation,
  primaryZone: Schema.String,
  selection: Schema.Option(Schema.String),
  source: EventRef,
});

export const prepareClipboardCut = Effect.fn("prepareClipboardCut")(
  function* prepareClipboardCut(input: typeof ClipboardCutInput.Type) {
    const { source } = input;

    const calendar = input.calendars.find(
      (candidate) =>
        candidate.accountId === source.accountId &&
        candidate.calendarId === source.calendarId
    );

    if (calendar === undefined || !writableCalendar(calendar)) {
      return yield* new ClipboardInputFailure({
        message:
          "The original calendar is no longer writable. The copied event is still available for Paste.",
        reason: "readOnlySource",
        source,
      });
    }

    const event = input.events.find(
      (candidate) =>
        candidate.accountId === source.accountId &&
        candidate.calendarId === source.calendarId &&
        candidate.eventId === source.eventId
    );

    if (event === undefined) {
      return yield* new ClipboardInputFailure({
        message:
          "The copied original is no longer available. No equivalent copy was selected for deletion.",
        reason: "missingSource",
        source,
      });
    }

    return EditorRequest.cases.Existing.make({
      calendars: input.calendars,
      event,
      mode: "delete",
      navigation: input.navigation,
      primaryZone: input.primaryZone,
      selection: input.selection,
    });
  }
);
