import {
  defaultDesktopPreferences,
  projectTrayDetails,
} from "@calendar/core/desktop-bridge";
import type { AgendaEventValue } from "@calendar/core/desktop-bridge";
import { composeParticipantEmail } from "@calendar/core/participant-email";

import type { NativeView } from "../src/native-host.js";

export const trayNow = 100_000;

export const trayEvent = (
  eventId: string,
  start = trayNow - 1000
): AgendaEventValue => {
  const title = "Saved meeting";

  const attachments = [
    { title: "Agenda", url: "https://files.example.test/agenda" },
    { title: "Notes", url: "https://files.example.test/notes" },
  ];

  return {
    allDay: false,
    attachments,
    calendarColor: "#64748b",
    conferenceUrl: "https://meet.example.test/room",
    end: trayNow + 10_000,
    hasLocation: true,
    hasParticipants: true,
    key: { accountId: "work", calendarId: "primary", eventId },
    participantEmails: ["guest@example.test"],
    responseStatus: "needsAction",
    rsvp: { enabled: true, response: "needsAction" },
    start,
    title,
    trayDetails: projectTrayDetails(
      "Room 42",
      attachments,
      composeParticipantEmail(title, ["guest@example.test"])
    ),
  };
};

export const trayView = (events: readonly AgendaEventValue[]): NativeView => ({
  agenda: { events },
  menuState: "closed",
  now: trayNow,
  preferences: defaultDesktopPreferences(),
});
