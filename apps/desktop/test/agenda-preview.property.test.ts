import type { AgendaSnapshotValue } from "@calendar/core/desktop-bridge";
import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";

import { menuAgenda, previewLabel } from "../src/agenda.js";

const now = 1_792_497_600_000;

const snapshot: AgendaSnapshotValue = {
  events: [
    {
      allDay: false,
      calendarColor: "#64748b",
      conferenceUrl: null,
      end: now + 50 * 60_000,
      hasLocation: false,
      hasParticipants: false,
      key: { accountId: "work", calendarId: "primary", eventId: "saved" },
      responseStatus: "accepted",
      start: now + 20 * 60_000,
      title: "Saved event",
    },
  ],
};

const time = () => "10:20";

it.effect.prop(
  "show-title histories change only the title portion of the actual native preview label",
  { history: Arbitrary.schema(Schema.Array(Schema.Boolean)) },
  ({ history }) =>
    Effect.sync(() => {
      for (const showTitle of [true, false, ...history]) {
        const preferences = {
          ...defaultDesktopPreferences(),
          showTime: true,
          showTitle,
        };

        expect(previewLabel(snapshot, preferences, now, time)).toBe(
          showTitle ? "10:20 Saved event" : "10:20"
        );
        expect(menuAgenda(snapshot, preferences, now)).toEqual(snapshot.events);
      }
    })
);

it.effect.prop(
  "show-time histories change only the time portion of the actual native preview label",
  { history: Arbitrary.schema(Schema.Array(Schema.Boolean)) },
  ({ history }) =>
    Effect.sync(() => {
      for (const showTime of [true, false, ...history]) {
        const preferences = {
          ...defaultDesktopPreferences(),
          showTime,
          showTitle: true,
        };

        expect(previewLabel(snapshot, preferences, now, time)).toBe(
          showTime ? "10:20 Saved event" : "Saved event"
        );
        expect(menuAgenda(snapshot, preferences, now)).toEqual(snapshot.events);
      }

      expect(
        previewLabel(
          snapshot,
          { ...defaultDesktopPreferences(), showTime: false, showTitle: false },
          now,
          time
        )
      ).toBe("");
    })
);
