import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { DateTime, Effect } from "effect";

import { Message, update } from "../src/client/app.js";
import { agendaSnapshot } from "../src/client/desktop/snapshot.js";
import {
  savedUpcomingEvent,
  upcomingFixture,
  upcomingKeys,
  upcomingNow,
  upcomingPerson,
} from "./upcoming-fixture.js";

const excludedLocation = "EXCLUDED LOCATION MUST NOT ENTER ANY PAYLOAD FIELD";

const sourceEvent = (eventId: string): CalendarEventValue => ({
  ...savedUpcomingEvent,
  eventId,
  iCalUID: `${eventId}@tray-location-fixture.test`,
  location: excludedLocation,
});

it.effect(
  "location appears exactly once for an eligible event and nowhere for excluded calendar, status, time or all-day rows",
  () =>
    Effect.sync(() => {
      const model = upcomingFixture([upcomingKeys[1] ?? ""]);

      const allowed = { ...sourceEvent("allowed"), location: "Eligible room" };

      const excluded: readonly CalendarEventValue[] = [
        { ...sourceEvent("unselected"), calendarId: "team" },
        { ...sourceEvent("cancelled"), status: "cancelled" },
        {
          ...sourceEvent("declined"),
          attendees: [
            {
              email: "self@example.test",
              responseStatus: "declined",
              self: true,
            },
          ],
        },
        {
          ...sourceEvent("all-day"),
          end: { date: "2026-10-22" },
          start: { date: "2026-10-21" },
        },
        { ...sourceEvent("missing-time"), start: undefined },
        {
          ...sourceEvent("expired"),
          end: {
            dateTime: DateTime.formatIso(DateTime.makeUnsafe(upcomingNow)),
          },
          start: {
            dateTime: DateTime.formatIso(
              DateTime.makeUnsafe(upcomingNow - 120_000)
            ),
          },
        },
        {
          ...sourceEvent("outside-horizon"),
          end: {
            dateTime: DateTime.formatIso(
              DateTime.makeUnsafe(upcomingNow + 5 * 24 * 60 * 60_000)
            ),
          },
          start: {
            dateTime: DateTime.formatIso(
              DateTime.makeUnsafe(upcomingNow + 4 * 24 * 60 * 60_000)
            ),
          },
        },
      ];

      const received = update(
        model,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: model.upcoming.request,
          result: { events: [allowed, ...excluded], versions: [] },
        })
      ).model;

      const snapshot = agendaSnapshot(received, defaultDesktopPreferences());

      expect(snapshot.events.map((event) => event.key.eventId)).toEqual([
        "allowed",
      ]);
      expect(snapshot.events[0]?.trayDetails?.location).toBe("Eligible room");
      expect(JSON.stringify(snapshot)).not.toContain(excludedLocation);
      expect(
        JSON.stringify({
          ...snapshot,
          events: snapshot.events.map((event) => ({
            ...event,
            trayDetails: { ...event.trayDetails, location: null },
          })),
        })
      ).not.toContain("Eligible room");
      expect(snapshot.events[0]).not.toHaveProperty("location");
      expect(snapshot.events[0]).not.toHaveProperty("description");
    })
);
