import type {
  AgendaEventValue,
  PromptPreferences,
} from "@calendar/core/desktop-bridge";

export const promptNow = 1_792_497_540_000;

export const promptMeeting: AgendaEventValue = {
  allDay: false,
  attachments: [{ title: "Document", url: "https://files.example.test/doc" }],
  calendarColor: "#64748b",
  conferenceUrl: "https://meet.example.test/room",
  end: promptNow + 3_600_000,
  hasLocation: false,
  hasParticipants: true,
  key: { accountId: "work", calendarId: "primary", eventId: "one" },
  participantEmails: ["guest@example.test"],
  responseStatus: "accepted",
  start: promptNow + 60_000,
  title: "Daily focus · Café ☕ Überprüfung",
};

export const promptPreferences: typeof PromptPreferences.Type = {
  joinShortcut: "Control+Command+J",
  theme: "dark",
  timeFormat: "24",
  version: 1,
};
