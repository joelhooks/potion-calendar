import type {
  CalendarRefValue,
  CalendarValue,
} from "@calendar/calendar/contracts";
import { createEffectLogic } from "@xstate/effect";
import { Crypto, Effect, Option } from "effect";

import {
  createDraft,
  eventDraft,
  initialRepeat,
} from "../../layout/editor-draft.js";
import { rebaseEditorRange } from "../../layout/editor-zone.js";
import {
  clipboardPasteMetadata,
  composeClipboardDraft,
} from "../clipboard/template.js";
import { CalendarEditingClient } from "./calendar-client.js";
import { applyEditorConferencingDefault } from "./conferencing-draft.js";
import {
  EditorLoadResult,
  EditorRequest,
  LoadedEditor,
} from "./editor-session-model.js";
import { EditorInputFailure } from "./input-failure.js";

export const writableCalendar = (calendar: CalendarValue): boolean =>
  calendar.accessRole === "owner" || calendar.accessRole === "writer";

const duplicateDestination = (
  calendars: readonly CalendarValue[],
  source: CalendarRefValue
): CalendarValue | undefined =>
  calendars.find(
    (calendar) =>
      calendar.accountId === source.accountId &&
      calendar.calendarId === source.calendarId &&
      writableCalendar(calendar)
  ) ??
  calendars.find(
    (calendar) => calendar.primary && writableCalendar(calendar)
  ) ??
  calendars.find(writableCalendar);

const loadNew = Effect.fn("loadNewEditor")(function* loadNew(
  request: typeof EditorRequest.cases.New.Type,
  id: string
) {
  const calendar = request.calendars.find(
    (item) =>
      item.accountId === request.ref.accountId &&
      item.calendarId === request.ref.calendarId &&
      writableCalendar(item)
  );

  if (calendar === undefined) {
    return yield* new EditorInputFailure({
      message: "Choose a writable calendar before creating an event.",
    });
  }

  const range = yield* rebaseEditorRange(
    request,
    request.rangeZone ?? request.primaryZone,
    request.primaryZone
  );

  const baseDraft = yield* createDraft({
    ...range,
    ref: request.ref,
    timeZone: request.primaryZone,
  });

  const draft =
    request.template === undefined
      ? baseDraft
      : composeClipboardDraft(baseDraft, request.template);

  const client = yield* CalendarEditingClient;

  const session = LoadedEditor.make({
    baseline: draft,
    calendars: request.calendars,
    conferencingContext: request.conferencingContext,
    createId: Option.some(id.replaceAll("-", "")),
    draft,
    id,
    intent: request.intent ?? "ordinary",
    kind: "create",
    master: Option.none(),
    moveSupport: client.moveSupport,
    navigation: request.navigation,
    operation: "save",
    original: Option.none(),
    selection: request.selection,
  });

  const prepared = {
    ...session,
    draft: applyEditorConferencingDefault(session),
  };

  return request.template === undefined
    ? prepared
    : LoadedEditor.make({
        ...prepared,
        clipboard: clipboardPasteMetadata(request.template),
        direct: true,
      });
});

const loadExisting = Effect.fn("loadExistingEditor")(function* loadExisting(
  request: typeof EditorRequest.cases.Existing.Type,
  id: string
) {
  const client = yield* CalendarEditingClient;
  const source = yield* client.getEvent(request.event);

  const master =
    source.recurringEventId === undefined
      ? undefined
      : yield* client.getEvent({
          accountId: source.accountId,
          calendarId: source.calendarId,
          eventId: source.recurringEventId,
        });

  let draft = yield* eventDraft(source, master, request.primaryZone);

  if (request.mode === "duplicate") {
    const target = duplicateDestination(request.calendars, source);

    if (target === undefined) {
      return yield* new EditorInputFailure({
        message: "There is no writable calendar for the duplicate.",
      });
    }

    const repeat = yield* initialRepeat(draft.startDate);
    draft = {
      ...draft,
      accountId: target.accountId,
      attendees: draft.attendees.map((person) => ({
        email: person.email,
        optional: person.optional ?? false,
        responseStatus: "needsAction",
      })),
      calendarId: target.calendarId,
      eventType: "default",
      repeat,
      statusInvitationChoice: undefined,
    };
  }

  const range =
    request.range === undefined
      ? undefined
      : yield* rebaseEditorRange(
          request.range,
          request.rangeZone ?? request.primaryZone,
          draft.timeZone
        );

  const session = LoadedEditor.make({
    baseline: draft,
    calendars: request.calendars,
    conferencingContext: request.conferencingContext,
    createId:
      request.mode === "duplicate"
        ? Option.some(id.replaceAll("-", ""))
        : Option.none(),
    direct: range !== undefined,
    draft: range === undefined ? draft : { ...draft, ...range },
    id,
    intent: request.intent ?? "ordinary",
    kind: request.mode === "duplicate" ? "duplicate" : "edit",
    master: Option.fromUndefinedOr(master),
    moveSupport: client.moveSupport,
    navigation: request.navigation,
    operation: request.mode === "delete" ? "delete" : "save",
    original: Option.some(source),
    selection: request.selection,
  });

  return { ...session, draft: applyEditorConferencingDefault(session) };
});

export const loadEditor = Effect.fn("loadEditor")(function* loadEditor(
  request: typeof EditorRequest.Type
) {
  const crypto = yield* Crypto.Crypto;

  const id = yield* crypto.randomUUIDv4.pipe(
    Effect.mapError(
      () =>
        new EditorInputFailure({
          message: "A local event identifier could not be created.",
        })
    )
  );

  return yield* EditorRequest.match(request, {
    Existing: (input) => loadExisting(input, id),
    New: (input) => loadNew(input, id),
  });
});

export const loadEditorLogic = createEffectLogic({
  effect: ({ input }) =>
    loadEditor(input).pipe(
      Effect.match({
        onFailure: (failure) => EditorLoadResult.cases.Failed.make({ failure }),
        onSuccess: (session) => EditorLoadResult.cases.Loaded.make({ session }),
      })
    ),
  schemas: { input: EditorRequest },
});
