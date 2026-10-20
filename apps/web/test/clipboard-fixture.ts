import { CalendarEvent } from "@calendar/calendar/contracts";
import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { Option } from "effect";

import { captureClipboardItem } from "../src/client/clipboard/capture.js";
import { ClipboardCaptureResult } from "../src/client/clipboard/model.js";

export const clipboardSource = CalendarEvent.make({
  accountId: "work",
  attendees: [
    { email: "owner@example.test", responseStatus: "accepted", self: true },
    {
      displayName: "Alex",
      email: "alex@example.test",
      optional: true,
      organizer: true,
      responseStatus: "accepted",
    },
  ],
  calendarId: "primary",
  colorId: "3",
  conferenceUrl: "https://meet.google.com/native-private",
  description: "A plain description.",
  end: { dateTime: "2026-10-19T10:30:00+09:00", timeZone: "Asia/Tokyo" },
  etag: "provider-only-etag",
  eventId: "copied-event",
  guestsCanInviteOthers: false,
  guestsCanModify: false,
  guestsCanSeeOtherGuests: false,
  iCalUID: "provider-only-ical",
  location: "Studio",
  recurringEventId: "source-series",
  reminders: {
    overrides: [{ method: "popup", minutes: 10 }],
    useDefault: false,
  },
  start: { dateTime: "2026-10-19T09:00:00+09:00", timeZone: "Asia/Tokyo" },
  status: "confirmed",
  title: "Product review",
  transparency: "transparent",
  visibility: "private",
});

export const clipboardItem = (event: CalendarEventValue = clipboardSource) => {
  const result = captureClipboardItem(event, ["owner@example.test"]);

  return Option.getOrThrow(
    ClipboardCaptureResult.guards.Captured(result)
      ? Option.some(result.item)
      : Option.none()
  );
};
