import { statusEventAvailability } from "@calendar/calendar/contracts";
import type { CalendarValue } from "@calendar/calendar/contracts";

import { BulkView } from "../bulk/model.js";
import { hasEditorConferencing } from "./conferencing-draft.js";
import type { ConferencingEditor } from "./conferencing-draft.js";
import { EditorView } from "./editor-model.js";
import type { EventDraftValue } from "./editor-model.js";
import type { EditingUi } from "./ui-model.js";

export const createTypeLabels = {
  birthday: "Birthday",
  default: "Event",
  focusTime: "Focus time",
  fromGmail: "From Gmail",
  outOfOffice: "Out of office",
  workingLocation: "Working location",
};

export const creationTypeAvailability = (
  calendars: readonly CalendarValue[],
  draft: EventDraftValue
) =>
  statusEventAvailability(
    calendars.find(
      (calendar) =>
        calendar.accountId === draft.accountId &&
        calendar.calendarId === draft.calendarId
    ),
    draft.allDay
  );

export const losslessTypeConversion = (session: ConferencingEditor) =>
  session.draft.statusInvitationChoice === undefined &&
  session.draft.attendees.length === 0 &&
  session.draft.participantEmail.trim() === "" &&
  !hasEditorConferencing(session) &&
  session.draft.conferencing?.request?.kind !== "googleMeet" &&
  session.draft.location === "" &&
  session.draft.description === "" &&
  (session.draft.attachments?.length ?? 0) === 0;

export const commandTypeChoices = (
  editing: Pick<typeof EditingUi.Type, "view" | "bulk">,
  calendars: readonly CalendarValue[]
) => {
  const { view } = editing;

  if (
    !EditorView.guards.Editing(view) ||
    view.kind !== "create" ||
    view.sessionId === undefined ||
    view.operation !== "save" ||
    !view.permissions.editMeeting ||
    BulkView.guards.Running(editing.bulk) ||
    BulkView.guards.Undoing(editing.bulk) ||
    !losslessTypeConversion({ ...view, calendars })
  ) {
    return [];
  }

  const availability = creationTypeAvailability(calendars, view.draft);

  return (["default", "focusTime", "outOfOffice"] as const).filter(
    (type) =>
      type !== (view.draft.eventType ?? "default") &&
      (type === "default" || availability.kind !== "ineligible")
  );
};
