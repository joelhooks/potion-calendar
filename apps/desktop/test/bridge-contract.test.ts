import {
  AgendaSnapshot,
  DesktopPreferences,
  DesktopSettings,
  GlobalShortcut,
  defaultDesktopPreferences,
} from "@calendar/core/desktop-bridge";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

const meeting = {
  allDay: false,
  calendarColor: "#64748b",
  conferenceUrl: "https://meet.example.test/room?code=123",
  end: 1_792_500_000_000,
  hasLocation: true,
  hasParticipants: true,
  key: { accountId: "account", calendarId: "calendar", eventId: "meeting" },
  responseStatus: "accepted",
  start: 1_792_496_400_000,
  title: "Saved meeting",
};

describe("desktop transport decoding", () => {
  it.effect("retains only the approved saved-event fields", () =>
    Effect.gen(function* decodedAgenda() {
      const snapshot = yield* Schema.decodeUnknownEffect(AgendaSnapshot)({
        events: [
          {
            ...meeting,
            attendees: [{ email: "private@example.test" }],
            description: "Private notes",
            location: "Private physical address",
            token: "not-a-real-token",
          },
        ],
      });

      expect(snapshot.events).toEqual([meeting]);
      expect(snapshot.events[0]?.hasLocation).toBe(true);
    })
  );

  it.effect("rejects unsafe conferencing and malformed agenda items", () =>
    Effect.sync(() => {
      const decode = Schema.decodeUnknownOption(AgendaSnapshot);

      for (const conferenceUrl of [
        "http://meet.example.test/room",
        // oxlint-disable-next-line no-script-url -- The IPC boundary must reject executable conferencing input.
        "javascript:alert(1)",
        "file:///private/meeting",
        "https://person:password@meet.example.test/room",
        "not a URL",
      ]) {
        expect(
          Option.isNone(decode({ events: [{ ...meeting, conferenceUrl }] }))
        ).toBe(true);
      }

      for (const item of [
        { ...meeting, hasLocation: "yes" },
        { ...meeting, hasParticipants: undefined },
        { ...meeting, key: { eventId: "meeting" } },
        { ...meeting, responseStatus: "unknown" },
        { ...meeting, end: meeting.start },
        { ...meeting, start: Number.NaN },
        { ...meeting, end: Number.POSITIVE_INFINITY },
      ]) {
        expect(Option.isNone(decode({ events: [item] }))).toBe(true);
      }

      expect(Option.isNone(decode({ events: "meetings" }))).toBe(true);
      expect(
        Option.isSome(decode({ events: [{ ...meeting, conferenceUrl: null }] }))
      ).toBe(true);
    })
  );

  it.effect(
    "validates the complete T13–T15 preferences and shortcut modifiers",
    () =>
      Effect.sync(() => {
        const preferences = defaultDesktopPreferences();
        const decode = Schema.decodeUnknownOption(DesktopPreferences);
        const shortcut = Schema.decodeUnknownOption(GlobalShortcut);

        for (const includeDays of [1, 2, 3, 4, 5, 6, 7, 14, 30]) {
          expect(Option.isSome(decode({ ...preferences, includeDays }))).toBe(
            true
          );
        }

        for (const previewMinutes of [
          0, 15, 30, 60, 240, 480, 720, 1440, 10_080,
        ]) {
          expect(
            Option.isSome(decode({ ...preferences, previewMinutes }))
          ).toBe(true);
        }

        for (const promptMinutes of [null, 0, 1, 2, 3, 5]) {
          expect(Option.isSome(decode({ ...preferences, promptMinutes }))).toBe(
            true
          );
        }

        expect(Option.isNone(decode({ ...preferences, includeDays: 28 }))).toBe(
          true
        );
        expect(
          Option.isNone(decode({ ...preferences, promptMinutes: 10 }))
        ).toBe(true);
        expect(
          Option.isNone(decode({ ...preferences, previewMinutes: 10_081 }))
        ).toBe(true);

        for (const value of [
          "K",
          "Command",
          "Control+",
          "Control+Shift",
          " Control+K",
        ]) {
          expect(Option.isNone(shortcut(value))).toBe(true);
        }

        for (const value of [
          null,
          "Control+Command+K",
          "Control+Alt+J",
          "Shift+F12",
        ]) {
          expect(Option.isSome(shortcut(value))).toBe(true);
        }
      })
  );

  it.effect("rejects settings replies that omit the OS login observation", () =>
    Effect.sync(() => {
      expect(
        Option.isNone(
          Schema.decodeUnknownOption(DesktopSettings)({
            issues: [],
            preferences: defaultDesktopPreferences(),
            revision: 1,
          })
        )
      ).toBe(true);
    })
  );
});
