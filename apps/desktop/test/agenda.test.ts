import type { AgendaEventValue } from "@calendar/core/desktop-bridge";
import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { menuAgenda, previewMeeting } from "../src/agenda.js";

const hour = 60 * 60_000;

const now = 1_792_497_600_000;

const eventAt = (eventId: string, hours: number): AgendaEventValue => ({
  allDay: false,
  calendarColor: "#64748b",
  conferenceUrl: "https://meet.example.test/room",
  end: now + (hours + 2) * hour,
  hasLocation: false,
  hasParticipants: true,
  key: { accountId: "work", calendarId: "primary", eventId },
  responseStatus: "accepted",
  start: now + hours * hour,
  title: "Saved meeting",
});

it.effect(
  "keeps the one-day list separate from an Always preview five days away",
  () =>
    Effect.sync(() => {
      const preferences = {
        ...defaultDesktopPreferences(),
        includeDays: 1,
        previewMinutes: 10_080,
      } satisfies ReturnType<typeof defaultDesktopPreferences>;

      const snapshot = {
        events: [eventAt("tomorrow", 12), eventAt("five-days", 120)],
      };

      const afterFirstMeeting = now + 15 * hour;

      expect(
        menuAgenda(snapshot, preferences, now).map((event) => event.key.eventId)
      ).toEqual(["tomorrow"]);
      expect(menuAgenda(snapshot, preferences, afterFirstMeeting)).toEqual([]);
      expect(
        previewMeeting(snapshot, preferences, afterFirstMeeting)?.key.eventId
      ).toBe("five-days");
      expect(
        previewMeeting(
          snapshot,
          { ...preferences, showTime: false, showTitle: false },
          afterFirstMeeting
        )
      ).toBeUndefined();
      expect(
        menuAgenda(snapshot, { ...preferences, menuBar: false }, now)
      ).toEqual([]);
    })
);
