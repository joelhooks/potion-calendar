import { Effect, Option } from "effect";

import { changeEditor } from "../src/client/editing/change-editor.js";
import type { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import type { EventDraftValue } from "../src/client/editing/editor-model.js";
import { LoadedEditor } from "../src/client/editing/editor-session-model.js";
import { permissionsForEditor } from "../src/client/editing/prepare-editor.js";
import { createDraft } from "../src/layout/editor-draft.js";
import { dayFromIso, initialNavigation } from "../src/layout/navigation.js";
import { editorCalendars } from "./editor-fixture.js";

export const reminderSession = (draft: EventDraftValue) =>
  LoadedEditor.make({
    baseline: draft,
    calendars: editorCalendars,
    createId: Option.some("0123456789abcdef"),
    draft,
    id: "reminder-editor-fixture",
    kind: "create",
    master: Option.none(),
    moveSupport: "notAvailable",
    navigation: initialNavigation(dayFromIso("2026-10-19")),
    operation: "save",
    original: Option.none(),
    selection: Option.none(),
  });

export const createReminderSession = Effect.fn("createReminderSession")(
  function* createReminderSession(allDay: boolean) {
    const draft = yield* createDraft({
      allDay,
      endDate: "2026-10-19",
      endTime: "10:00",
      ref: { accountId: "work", calendarId: "primary" },
      startDate: "2026-10-19",
      startTime: "09:00",
      timeZone: "America/Los_Angeles",
    });

    return reminderSession({
      ...draft,
      title: allDay ? "All-day reminder picker" : "Timed reminder picker",
    });
  }
);

export const applyReminderAction = (
  session: typeof LoadedEditor.Type,
  action: typeof EditorAction.Type
) => changeEditor({ action, custom: Option.none(), session });

export const reminderEditorView = (
  session: typeof LoadedEditor.Type,
  error: Option.Option<string> = Option.none()
) =>
  EditorView.cases.Editing.make({
    draft: session.draft,
    error,
    kind: session.kind,
    moveSupport: session.moveSupport,
    operation: session.operation,
    original: session.original,
    permissions: permissionsForEditor(session),
  });
