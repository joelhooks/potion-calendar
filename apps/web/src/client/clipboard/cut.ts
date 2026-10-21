import {
  Calendar,
  CalendarEvent,
  EventRef,
} from "@calendar/calendar/contracts";
import { Effect, Option, Result, Schema } from "effect";

import { BulkPlan, BulkStep } from "../../layout/bulk-plans.js";
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

export const ClipboardGroupCutInput = Schema.Struct({
  calendars: ClipboardCutInput.fields.calendars,
  events: ClipboardCutInput.fields.events,
  navigation: ClipboardCutInput.fields.navigation,
  primaryZone: Schema.String,
  selection: Schema.NonEmptyArray(Schema.NonEmptyString),
  sources: Schema.NonEmptyArray(EventRef),
});

export const prepareClipboardGroupCut = Effect.fn("prepareClipboardGroupCut")(
  function* prepareClipboardGroupCut(
    input: typeof ClipboardGroupCutInput.Type
  ) {
    if (input.selection.length !== input.sources.length) {
      return yield* new ClipboardInputFailure({
        message:
          "The copied selection no longer has one exact source per member. Nothing was deleted.",
        reason: "incompleteSelection",
      });
    }

    const steps: (typeof BulkStep.Type)[] = [];
    const skipped: (typeof BulkPlan.Type)["skipped"][number][] = [];
    const included = new Set<string>();

    for (const [index, source] of input.sources.entries()) {
      const key = input.selection[index];

      if (key === undefined) {
        return yield* new ClipboardInputFailure({
          message: "The copied selection is incomplete. Nothing was deleted.",
          reason: "incompleteSelection",
        });
      }

      const request = yield* prepareClipboardCut({
        ...input,
        selection: Option.some(key),
        source,
      }).pipe(Effect.result);

      const identity = JSON.stringify([
        source.accountId,
        source.calendarId,
        source.eventId,
      ]);

      const title =
        input.events.find(
          (event) =>
            event.accountId === source.accountId &&
            event.calendarId === source.calendarId &&
            event.eventId === source.eventId
        )?.title ?? "Event";

      if (Result.isFailure(request)) {
        skipped.push({ key, reason: request.failure.message, title });
      } else if (included.has(identity)) {
        skipped.push({
          key,
          reason:
            "This exact source is already included in the group deletion.",
          title,
        });
      } else {
        included.add(identity);
        steps.push(
          BulkStep.make({
            key,
            request: { ...request.success, mode: "delete" },
            scope: "single",
          })
        );
      }
    }

    return BulkPlan.make({ operation: "delete", skipped, steps });
  }
);
