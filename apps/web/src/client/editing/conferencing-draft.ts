import {
  automaticConferencingRequest,
  conferenceLink,
  ConferencingDefault,
  ConferencingRequest,
} from "@calendar/calendar/conferencing";
import type {
  CalendarEventValue,
  CalendarValue,
} from "@calendar/calendar/contracts";
import { Option, Schema } from "effect";

import {
  UserDefaultConferencing,
  deskDefaultConferencing,
  resolvedConferencingDefault,
} from "../settings/conferencing/default.js";
import type { EventDraftValue } from "./editor-model.js";

export const EditorConferencingContext = Schema.Struct({
  accounts: Schema.Array(
    Schema.Struct({
      accountId: Schema.String,
      email: Schema.String,
      setting: Schema.optional(ConferencingDefault),
    })
  ),
  defaultConferencing: Schema.optionalKey(UserDefaultConferencing),
});

export const ConferencingDraft = Schema.Struct({
  participantSeen: Schema.Boolean,
  request: Schema.optional(ConferencingRequest),
});

export interface ConferencingEditor {
  readonly calendars: readonly CalendarValue[];
  readonly conferencingContext?:
    | typeof EditorConferencingContext.Type
    | undefined;
  readonly draft: EventDraftValue;
  readonly kind: "create" | "edit" | "duplicate";
  readonly original: Option.Option<CalendarEventValue>;
}

const sourceConference = (editor: ConferencingEditor) =>
  editor.kind === "edit" ? Option.getOrUndefined(editor.original) : undefined;

export const editorConferenceLink = (
  editor: ConferencingEditor
): string | undefined =>
  editor.draft.conferencing?.request === undefined
    ? conferenceLink(
        sourceConference(editor)?.conferenceUrl,
        editor.draft.location,
        editor.draft.description
      )
    : undefined;

export const hasEditorConferencing = (editor: ConferencingEditor): boolean =>
  editor.draft.conferencing?.request === undefined &&
  (sourceConference(editor)?.conference !== undefined ||
    sourceConference(editor)?.conferencingStatus !== undefined ||
    editorConferenceLink(editor) !== undefined);

export const editorNeedsConferenceReplacement = (
  editor: ConferencingEditor
): boolean => {
  const source = sourceConference(editor);

  return (
    hasEditorConferencing(editor) &&
    !(
      source?.conferencingStatus === "failed" &&
      source.conference === undefined &&
      editorConferenceLink(editor) === undefined
    )
  );
};

export const editorMeetUnavailable = (
  editor: ConferencingEditor,
  editable: boolean
): string | undefined => {
  const calendar = editor.calendars.find(
    (value) =>
      value.accountId === editor.draft.accountId &&
      value.calendarId === editor.draft.calendarId
  );

  if (
    calendar === undefined ||
    (calendar.accessRole !== "owner" && calendar.accessRole !== "writer")
  ) {
    return "This calendar is read-only.";
  }

  if (!editable) {
    return "Google does not permit changing this event's conferencing.";
  }

  const eventType =
    sourceConference(editor)?.eventType ?? editor.draft.eventType;

  if (eventType !== undefined && eventType !== "default") {
    return "Google Meet is not available for this event type.";
  }

  return calendar.allowedConferenceSolutionTypes?.includes("hangoutsMeet") ===
    true
    ? undefined
    : "This calendar can't add Google Meet.";
};

export const applyEditorConferencingDefault = (
  editor: ConferencingEditor
): EventDraftValue => {
  const state = editor.draft.conferencing;

  const account = editor.conferencingContext?.accounts.find(
    (value) => value.accountId === editor.draft.accountId
  );

  if (account === undefined) {
    return editor.draft;
  }

  const next = automaticConferencingRequest({
    attendees: editor.draft.attendees,
    hasConferencing: hasEditorConferencing(editor),
    isNew: editor.kind !== "edit",
    participantSeen: state?.participantSeen ?? false,
    request: state?.request,
    selfEmail: account?.email,
    setting:
      editorMeetUnavailable(editor, true) === undefined
        ? resolvedConferencingDefault(
            account.setting,
            editor.conferencingContext?.defaultConferencing ??
              deskDefaultConferencing
          )
        : undefined,
  });

  return { ...editor.draft, conferencing: next };
};

export const withoutConferenceLinks = (value: string): string =>
  value.replaceAll(/https?:\/\/[^\s<>"']+/gu, (candidate) => {
    const url = candidate.replace(/[),.;]+$/u, "");

    return conferenceLink(undefined, url) === undefined
      ? candidate
      : candidate.slice(url.length);
  });

export const requestEditorConferencing = (
  editor: ConferencingEditor,
  request: typeof ConferencingRequest.Type
): EventDraftValue => ({
  ...editor.draft,
  conferencing: {
    participantSeen: editor.draft.conferencing?.participantSeen ?? false,
    request,
  },
  description: withoutConferenceLinks(editor.draft.description),
  location: withoutConferenceLinks(editor.draft.location),
});
