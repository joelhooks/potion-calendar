import { googleCalendarCapabilities } from "@calendar/calendar/contracts";
import type {
  CalendarEventValue,
  CalendarValue,
} from "@calendar/calendar/contracts";
import { Option } from "effect";
import { renderToString } from "foldkit/experimental/server";
import type { Document, HtmlBuilder } from "foldkit/html";

import type { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import type {
  EventDraftValue,
  EditorViewValue,
} from "../src/client/editing/editor-model.js";
import { view as appView } from "../src/features/app.js";
import { editorDialogs } from "../src/features/event-editor.js";
import { undoFixture } from "./undo-fixture.js";

export const editorCalendars: readonly CalendarValue[] = [
  {
    accessRole: "owner",
    accountId: "work",
    backgroundColor: "#4986E8",
    calendarId: "primary",
    defaultReminders: [{ method: "popup", minutes: 30 }],
    primary: true,
    selected: true,
    timeZone: "America/Los_Angeles",
    title: "Work",
  },
  {
    accessRole: "writer",
    accountId: "work",
    backgroundColor: "#5ECC89",
    calendarId: "team",
    primary: false,
    selected: true,
    timeZone: "America/Los_Angeles",
    title: "Team",
  },
  {
    accessRole: "owner",
    accountId: "personal",
    backgroundColor: "#B8B8B8",
    calendarId: "personal",
    primary: true,
    selected: true,
    timeZone: "America/Los_Angeles",
    title: "Personal",
  },
];

export const editorOriginal: CalendarEventValue = {
  accountId: "work",
  attendees: [
    { email: "owner@example.test", responseStatus: "accepted", self: true },
    {
      email: "guest@example.test",
      optional: true,
      responseStatus: "needsAction",
    },
  ],
  calendarId: "primary",
  end: { dateTime: "2026-10-19T10:00:00-07:00" },
  eventId: "fixture-instance",
  iCalUID: "fixture-series@example.test",
  organizer: { email: "owner@example.test", self: true },
  originalStartTime: { dateTime: "2026-10-19T09:00:00-07:00" },
  recurringEventId: "fixture-series",
  start: { dateTime: "2026-10-19T09:00:00-07:00" },
  status: "confirmed",
  title: "Product review",
};

export const editorDraft: EventDraftValue = {
  accountId: "work",
  allDay: false,
  attendees: editorOriginal.attendees ?? [],
  calendarId: "primary",
  colorId: null,
  description: "Review the prototype and choose the next slice.",
  endDate: "2026-10-19",
  endTime: "10:00",
  location: "Studio",
  participantEmail: "",
  reminderInput: "",
  reminders: {
    overrides: [
      { method: "popup", minutes: 10 },
      { method: "popup", minutes: 30 },
    ],
    useDefault: false,
  },
  repeat: {
    count: "10",
    end: "never",
    frequency: "WEEKLY",
    interval: "1",
    monthPattern: "date",
    ordinal: "3",
    preset: "unchanged",
    rules: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
    until: "2026-12-31",
    weekday: "MO",
    weekdays: ["MO"],
  },
  startDate: "2026-10-19",
  startTime: "09:00",
  timeZone: "America/Los_Angeles",
  title: "Product review",
};

export const editorViewFields = {
  draft: editorDraft,
  error: Option.none<string>(),
  kind: "edit",
  moveSupport: "notAvailable",
  operation: "save",
  original: Option.some(editorOriginal),
  permissions: {
    calendarWritable: true,
    editGuests: true,
    editMeeting: true,
    inviteGuests: true,
  },
} satisfies Omit<typeof EditorView.cases.Editing.Type, "_tag">;

export const editingFixture = EditorView.cases.Editing.make(editorViewFields);

export const scopeFixture = EditorView.cases.Scope.make({
  ...editorViewFields,
  choices: ["single", "allFollowing", "all"],
  selected: Option.some("single"),
});

export const emailFixture = EditorView.cases.Email.make(editorViewFields);

export const repeatFixture = EditorView.cases.CustomRepeat.make({
  ...editorViewFields,
  custom: {
    ...editorDraft.repeat,
    end: "after",
    interval: "2",
    preset: "custom",
    weekdays: ["MO", "WE"],
  },
});

const fixtureView = (
  model: EditorViewValue,
  h: HtmlBuilder<typeof EditorAction.Type>,
  calendars = editorCalendars
): Document => ({
  body: h.div(
    [h.Class("editor-fixture")],
    [
      ...editorDialogs(h, {
        calendars,
        model,
        reminderLimit: googleCalendarCapabilities.maxRemindersCount,
        send: (action) => action,
      }),
    ]
  ),
  title: "Calendar editor fixture",
});

export const renderUndoFixture = () =>
  renderToString(
    { init: () => ({ model: undoFixture().pending }), view: appView },
    { isHydratable: false }
  );

export const renderEditorFixture = (
  model: EditorViewValue = editingFixture,
  calendars = editorCalendars
) =>
  renderToString(
    {
      init: () => ({ model }),
      view: (value, h: HtmlBuilder<typeof EditorAction.Type>) =>
        fixtureView(value, h, calendars),
    },
    { isHydratable: false }
  );
