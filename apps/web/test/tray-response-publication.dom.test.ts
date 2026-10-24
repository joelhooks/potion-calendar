import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Message, update } from "../src/client/app.js";
import { agendaSnapshot } from "../src/client/desktop/snapshot.js";
import {
  savedUpcomingEvent,
  upcomingFixture,
  upcomingPerson,
} from "./upcoming-fixture.js";

it.effect.each([
  { expected: null, responseStatus: undefined },
  { expected: "needsAction", responseStatus: "needsAction" },
  { expected: "accepted", responseStatus: "accepted" },
  { expected: "tentative", responseStatus: "tentative" },
] as const)(
  "the accepted agenda preserves actual self response $expected rather than display fallback",
  ({ responseStatus, expected }) =>
    Effect.sync(() => {
      const model = upcomingFixture();

      const loaded = update(
        model,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: model.upcoming.request,
          result: {
            events: [
              {
                ...savedUpcomingEvent,
                attendees: [
                  { email: "self@example.test", responseStatus, self: true },
                ],
              },
            ],
            versions: [],
          },
        })
      ).model;

      expect(
        agendaSnapshot(loaded, defaultDesktopPreferences()).events[0]
      ).toMatchObject({
        rsvp: { enabled: true, response: expected },
      });
    })
);

it.effect(
  "another participant does not grant the current person tray RSVP",
  () =>
    Effect.sync(() => {
      const model = upcomingFixture();

      const loaded = update(
        model,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: model.upcoming.request,
          result: {
            events: [
              {
                ...savedUpcomingEvent,
                attendees: [
                  { email: "other@example.test", responseStatus: "accepted" },
                ],
              },
            ],
            versions: [],
          },
        })
      ).model;

      expect(
        agendaSnapshot(loaded, defaultDesktopPreferences()).events[0]
      ).not.toHaveProperty("rsvp");
    })
);
