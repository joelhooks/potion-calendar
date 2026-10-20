import { desktopWire } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { hostedFailureTrace } from "../e2e/hosted-diagnostics.ts";

it.effect(
  "failure timelines retain frame rejection and relative clocks without printing raw agenda identities or URLs",
  () =>
    Effect.gen(function* nativeFailureTrace() {
      const payload = yield* Schema.encodeEffect(desktopWire.agenda)({
        events: [
          {
            allDay: false,
            calendarColor: "#64748b",
            conferenceUrl: "https://meet.example.test/private-room",
            end: 200,
            hasLocation: false,
            hasParticipants: false,
            key: {
              accountId: "private-account",
              calendarId: "private-calendar",
              eventId: "private-event",
            },
            responseStatus: "accepted",
            start: 150,
            title: "Safe title",
          },
        ],
      });

      const report = hostedFailureTrace(
        Option.some({
          dropped: 0,
          navigations: [{ kind: "navigated", timestamp: 100 }],
          publications: [
            {
              navigated: true,
              payload,
              sameFrameCoordinates: true,
              sameFrameObject: false,
              sameSender: true,
              timestamp: 105,
            },
          ],
          selectedWindowMatchesPage: true,
          windowCount: 1,
        }),
        [],
        100,
        103
      );

      expect(report.native?.publications[0]).toMatchObject({
        afterReloadMilliseconds: 5,
        afterSaveMilliseconds: 2,
        agenda: { count: 1, titles: ["Safe title"] },
        sameFrameCoordinates: true,
        sameFrameObject: false,
      });
      const json = JSON.stringify(report);

      for (const value of [
        "private-account",
        "private-calendar",
        "private-event",
        "private-room",
        "payload",
      ]) {
        expect(json).not.toContain(value);
      }
    })
);

it.effect(
  "malformed agenda diagnostics never print their undecoded input",
  () =>
    Effect.sync(() => {
      const report = hostedFailureTrace(
        Option.some({
          dropped: 0,
          navigations: [],
          publications: [
            {
              navigated: false,
              payload: "private malformed value",
              sameFrameCoordinates: false,
              sameFrameObject: false,
              sameSender: true,
              timestamp: 10,
            },
          ],
          selectedWindowMatchesPage: true,
          windowCount: 1,
        }),
        [],
        0
      );

      expect(report.native?.publications[0]?.agenda).toBeNull();
      expect(JSON.stringify(report)).not.toContain("private malformed value");
    })
);
